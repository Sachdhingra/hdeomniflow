// Mirrors the SQL trigger `public.create_thank_you_message`.
// Use this helper if you ever need to render or preview the message in the UI.
export function getThankYouTemplate(
  customerName: string,
  overallRating: number,
  experienceRating: number,
  businessPhone?: string
): string {
  const phoneLine = businessPhone ? `\n📞 ${businessPhone}` : "";

  if (overallRating === 5 && experienceRating === 5) {
    return `Hi ${customerName}! 🌟

We're absolutely thrilled with your amazing feedback! You made our day.

We'd love your Google review.

As a thank you, here's 10% off: code THANKYOU10

See you soon! 🛋️
Home Decor Enterprises - Patel Nagar${phoneLine}`;
  }
  if (overallRating >= 4) {
    return `Hi ${customerName}! 😊

Thank you for the wonderful feedback!

Special offer: 5% off — code VISITAGAIN5.

Home Decor Enterprises${phoneLine}`;
  }
  if (overallRating === 3) {
    return `Hi ${customerName}!

Thank you for your feedback! We appreciate it.

How can we improve? Let us know anytime.
Home Decor Enterprises${phoneLine}`;
  }
  return `Hi ${customerName}!

Thank you for your honest feedback. We're sorry we didn't meet your expectations.

How can we make it right? Please call us.${phoneLine}
Home Decor Enterprises`;
}
