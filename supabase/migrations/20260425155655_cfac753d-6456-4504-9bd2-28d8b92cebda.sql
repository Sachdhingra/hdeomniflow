-- Add 'self_delivery' to service_job_type enum
ALTER TYPE service_job_type ADD VALUE IF NOT EXISTS 'self_delivery';