-- Server-side auto "on site" detection.
--
-- Problem: auto-reach was computed client-side in FieldAgentDashboard and only
-- ran while the field agent had that page open with GPS on. If the agent closed
-- the app or switched GPS off, the job never flipped to on_site.
--
-- Fix: drive auto-reach from agent_live_locations, which is pinged every ~30s
-- app-wide (from AppLayout) regardless of which screen is open. Whenever a ping
-- lands, mark any of that agent's active jobs on_site if the ping is within the
-- geofence of the job site. Accuracy-aware so a coarse fix near the door counts.

CREATE OR REPLACE FUNCTION public.auto_mark_on_site()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_radius_m CONSTANT DOUBLE PRECISION := 150;   -- geofence radius
  accuracy_cap_m CONSTANT DOUBLE PRECISION := 120;  -- max slack granted for a coarse fix
  effective_radius DOUBLE PRECISION;
BEGIN
  -- Grant extra slack up to accuracy_cap_m when the fix itself is imprecise,
  -- so a genuine arrival with a poor GPS fix is not rejected forever.
  effective_radius := base_radius_m + LEAST(COALESCE(NEW.accuracy, 0), accuracy_cap_m);

  UPDATE public.service_jobs sj
  SET status = 'on_site'::service_job_status,
      agent_reached_at = COALESCE(sj.agent_reached_at, now()),
      updated_at = now()
  WHERE sj.assigned_agent = NEW.agent_id
    AND sj.deleted_at IS NULL
    AND sj.agent_reached_at IS NULL
    AND sj.status IN ('on_route'::service_job_status, 'in_progress'::service_job_status)
    AND sj.location_lat IS NOT NULL
    AND sj.location_lng IS NOT NULL
    -- Haversine distance (meters) between the ping and the job site.
    AND (
      2 * 6371000 * asin(sqrt(
        power(sin(radians(sj.location_lat - NEW.latitude) / 2), 2)
        + cos(radians(NEW.latitude)) * cos(radians(sj.location_lat))
          * power(sin(radians(sj.location_lng - NEW.longitude) / 2), 2)
      ))
    ) <= effective_radius;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_mark_on_site ON public.agent_live_locations;
CREATE TRIGGER trg_auto_mark_on_site
  AFTER INSERT ON public.agent_live_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_mark_on_site();
