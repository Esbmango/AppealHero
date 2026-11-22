# AppealHero
**A parking-ticket appeal you can review in your language and verify after filing.**

## Inspiration

A parking receipt can settle a simple question: did the driver pay for the time on the ticket? Understanding the notice, finding the relevant evidence and writing a formal appeal in English can still be difficult. We built AppealHero around that experience for Boston residents and visitors.

## What it does

Drivers can photograph a synthetic ticket or find one in our simulated portal. AppealHero asks for missing evidence, explains the strength of the case, and shows what might count against it. The interface supports English, Spanish and Chinese. Drivers can also share personal circumstances for a discretionary request.

In the recorded example, a driver receives a meter ticket at 10:05 a.m. A payment receipt for the same plate covers 9:30–10:30 a.m. The driver confirms the facts, reviews the English letter and the evidence behind each paragraph, then approves the submission. The proof page shows a confirmation number, the portal read-back and a downloadable browser trace.

## How we built it

React and TypeScript power the web app. A Fastify server coordinates the case, deterministic rule checks and Gemini. Playwright operates a separate simulated appeals portal. The two approval steps live in application code. A change to the approved form changes its fingerprint. The executor reads the form back before submitting.

## What we learned

A receipt is useful only when the vehicle and time interval match the ticket. A successful click also tells the user little about what was sent. Making both comparisons visible gave the demo a clearer purpose and exposed bugs that simpler happy-path tests missed.

## Demo and verification

The recording uses synthetic people, tickets and receipts, our deterministic offline mode, and a real browser running against the simulated portal. Earlier live Gemini tests covered ticket reading, voice transcription and a Sunday-meter appeal. The redesigned-portal Gemini Computer Use trial did not complete; the recorded demo uses Playwright. AppealHero is an independent hackathon prototype that provides general information. The City of Boston is unaffiliated with the project.

## Next steps

Test camera and microphone capture on physical devices and evaluate the expanded evidence workflow with real Gemini calls. The [one-minute demo](demo/appealhero-pitch.mp4) meets the published [BostonHacks video length](https://bostonhacks-2026.devpost.com/rules). The [original continuous recording](demo/appealhero-demo.webm), [cover](demo/cover.png), and [four screenshots](demo/) are also available.
