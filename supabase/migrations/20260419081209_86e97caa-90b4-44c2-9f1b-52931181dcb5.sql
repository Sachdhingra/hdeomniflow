-- Allow all authenticated users to view basic profile info so Lead Owner can be displayed across roles
CREATE POLICY "Authenticated users can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);