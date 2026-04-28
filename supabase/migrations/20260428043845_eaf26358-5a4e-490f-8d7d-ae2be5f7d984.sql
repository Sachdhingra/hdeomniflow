-- Message templates table for WhatsApp psychology-driven sales
CREATE TABLE public.message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage TEXT NOT NULL CHECK (stage IN ('problem','exploration','evaluation','reassurance','decision')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  variables TEXT[] NOT NULL DEFAULT '{}',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view active templates (sales need them to send)
CREATE POLICY "View active templates"
ON public.message_templates FOR SELECT TO authenticated
USING (is_active = true OR has_role(auth.uid(), 'admin'::app_role));

-- Only admins manage templates
CREATE POLICY "Admins manage templates"
ON public.message_templates FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_message_templates_updated_at
BEFORE UPDATE ON public.message_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_message_templates_stage ON public.message_templates(stage, sort_order) WHERE is_active = true;

-- Track which template was used on lead_messages
ALTER TABLE public.lead_messages
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.message_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS journey_stage TEXT;

-- Seed all 19 templates
INSERT INTO public.message_templates (stage, title, body, variables, sort_order) VALUES
-- PROBLEM
('problem', 'Problem Acknowledgment',
'Hi {{name}}, thanks for reaching out about {{product}}.

Most families come to us because their current {{space}} isn''t working the way they need. Is that what''s happening with you?',
ARRAY['name','product','space'], 1),

('problem', 'Problem Deep-Dive',
'Got it—so you''re looking for {{stated_need}}.

Before I show options, one quick question:
What''s the main issue with your current setup?
(Space? Durability? Style? Comfort?)',
ARRAY['stated_need'], 2),

('problem', 'Neighborhood Social Proof',
'Perfect timing! Just had a family from {{neighborhood}} pick exactly this. They said the main difference was {{benefit1}}.

Interested in hearing more?',
ARRAY['neighborhood','benefit1'], 3),

('problem', 'Area Customization',
'Since you''re in {{neighborhood}}, I know the space constraints there.
This piece is popular in your area because {{local_reason}}.

Want to see how it looks in homes like yours?',
ARRAY['neighborhood','local_reason'], 4),

-- EXPLORATION
('exploration', 'Guided Selling - Style',
'Awesome {{name}}! Quick clarity question:

Do you prefer:
🏢 Modern minimalist (clean lines, neutral)
🏛️ Traditional (classic, warm)
🎨 Mix (bit of both)

That helps me show exactly the right pieces.',
ARRAY['name'], 1),

('exploration', 'Product Comparison',
'Between these two options:

Option A: {{product1}}
→ Better for {{benefit1}}

Option B: {{product2}}
→ Better for {{benefit2}}

Which resonates more?',
ARRAY['product1','product2','benefit1','benefit2'], 2),

('exploration', 'Visual Social Proof',
'Here''s one similar setup in {{neighborhood}}.
Family with {{family_type}} chose this exact configuration.

Want to see more options matching your style?',
ARRAY['neighborhood','family_type'], 3),

('exploration', 'Anchor Price Softly',
'Budget is important. You mentioned {{budget_range}}.

Good news—we have solid options throughout that range.
Let me filter to your budget level and send 2-3 pieces. Sound good?',
ARRAY['budget_range'], 4),

-- EVALUATION
('evaluation', 'Quality Proof',
'Quick note on quality—this piece:
✓ Used in 200+ homes in Dehradun
✓ 8+ year lifespan (families proving it)
✓ Covers kids + pets scenario

{{neighborhood}} families specifically love it for durability.',
ARRAY['neighborhood'], 1),

('evaluation', 'Family Alignment',
'One more thing—does {{spouse_name}}/family have a preference between these styles?

I can tailor the pitch so everyone''s happy with the choice.',
ARRAY['spouse_name'], 2),

('evaluation', 'Objection Address - Budget',
'{{name}}, I know budget matters.

Here''s the difference: This is ₹{{price1}}, that''s ₹{{price2}}.
The ₹{{difference}} extra gets you:
• Better wood quality
• Longer lifespan
• Better warranty

Your call, but the long-term value is here.',
ARRAY['name','price1','price2','difference'], 3),

('evaluation', 'Objection Address - Fit',
'Size question—your space is roughly {{space_size}}.

This fits perfectly (we''ve done {{neighborhood}} homes same size).
Want me to show you a photo overlay on your space? 5 mins.',
ARRAY['space_size','neighborhood'], 4),

-- REASSURANCE
('reassurance', 'Process Clarity',
'Great choice! Here''s exactly what happens next:

1️⃣ Confirm color/size (2 mins)
2️⃣ Advance payment (₹{{amount}})
3️⃣ Delivery booked + installation

Ready to start? Just reply YES.',
ARRAY['amount'], 1),

('reassurance', 'Delivery Reassurance',
'About delivery—here''s our process:

✓ Photos before loading (proof if any damage)
✓ Careful transport + white glove service
✓ Assembly included
✓ Photos after setup
✓ Free check-up 3 months later

Zero chaos, all handled.',
ARRAY[]::TEXT[], 2),

('reassurance', 'Spouse/Family Reassurance',
'Want to loop in {{spouse_name}}? I can do a quick 15-min call showing both of you exactly how it fits + works.

That way no surprises, everyone''s aligned. Good?',
ARRAY['spouse_name'], 3),

('reassurance', 'Confidence Boost',
'{{name}}, you''ve made a great choice. Families always tell us:
"Wish we''d done this sooner."

Your space is about to feel amazing. Let''s make it happen?',
ARRAY['name'], 4),

-- DECISION
('decision', 'Move to Close',
'Perfect! Let''s finalize:

[Payment Link]
Click above → confirm details → done in 2 mins.

You''re all set. We''ll confirm delivery date by EOD today.',
ARRAY[]::TEXT[], 1),

('decision', 'Final Urgency',
'One thing—this color is in stock now.
Next batch: 6 weeks.

Want to lock it in today?',
ARRAY[]::TEXT[], 2),

('decision', 'Post-Purchase',
'🎉 Order confirmed, {{name}}!

Delivery scheduled: {{date}}
We''ll confirm 24 hours before.

Questions? I''m here. This is going to transform your {{space}}.',
ARRAY['name','date','space'], 3);