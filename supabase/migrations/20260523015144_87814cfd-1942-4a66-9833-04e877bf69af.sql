
DROP TRIGGER IF EXISTS trg_customer_feedback_before_insert ON public.customer_feedback;
DROP TRIGGER IF EXISTS trg_customer_feedback_thank_you ON public.customer_feedback;

CREATE TRIGGER trg_customer_feedback_before_insert
  BEFORE INSERT ON public.customer_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_customer_feedback_insert();

CREATE TRIGGER trg_customer_feedback_thank_you
  AFTER INSERT ON public.customer_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.create_thank_you_message();
