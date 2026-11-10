# Website chat assistant (website-agent): diagnosis

No code or settings were changed.

## Exact logged error (console.error, index.ts:592)

Logged twice in the last 24-48 hours, with request IDs req_011CgthiA1pbNhufw1ydbGeG and req_011CgthuTnDXncwfXVX1p8MC:

```text
Error: Claude 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CgthuTnDXncwfXVX1p8MC"}
    at Object.handler (file:///var/tmp/sb-compile-edge-runtime/website-agent/index.ts:592:24)
```

The cause is billing on the Anthropic account. The key is accepted, so this is not a 401, a wrong model, or a fetch/JSON error.

## Secrets (names only)

- ANTHROPIC_API_KEY: set
- AGENT_MODEL: set
- ANTHROPIC_BASE_URL: not set (the function uses its default Anthropic endpoint)

## Suggested fix (needs your approval)

1. Add credits on the Anthropic console (Plans & Billing) for the account that owns ANTHROPIC_API_KEY. No code change is needed. Chat should recover on the next message.
2. Optional: switch website-agent to the built-in Lovable AI models so it no longer depends on Anthropic credits. This is a code change and is only done if you ask for it.

Related: voice-reminder is also failing because its Gemini prepaid credits are used up (Gemini TTS error 402, RESOURCE_EXHAUSTED).
