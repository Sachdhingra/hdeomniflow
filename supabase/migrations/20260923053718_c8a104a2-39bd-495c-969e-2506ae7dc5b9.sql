UPDATE public.lead_messages
SET status = 'failed',
    failed_at = COALESCE(failed_at, now()),
    error_message = 'Twilio error 63049'
WHERE provider_message_id = 'MM41171bde2223971151f0423e47e413fc';

UPDATE public.message_logs
SET status = 'failed',
    error_message = 'Twilio error 63049'
WHERE provider_message_id = 'MM41171bde2223971151f0423e47e413fc';