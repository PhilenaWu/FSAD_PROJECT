# AI reflection — Davian

## UC-006 · UC-009 · UC-011

My work on this project was the core analytical and automation engines: UC-006 (AI Recommendation Engine), UC-009 (Automated PDF Reporting), and the backend for UC-011 (Operational Cost Dashboard).

## What I used AI for

I used Claude as a high-level pair programmer. My approach was simple: let the AI handle the heavy lifting of boilerplate and complex SQL, so I could focus on the architecture and ensuring the results actually made sense for a property manager. I worked independently, but I was always the one making sure the "AI magic" didn't hallucinate something that would break our budget.

## Where AI added value

The real win with AI wasn't just writing code—it was data aggregation and forecasting.

- Complex SQL: For the Velocity Calculator (UC-006), Claude helped me draft the 30-day windowed queries that compare current defect rates against historical baselines. Doing this manually would have been a headache, but the AI laid out the structure in seconds.

- Predictive Modeling: In the Cost Dashboard (UC-011), I used AI to implement a damped-trend exponential smoothing model for cost forecasting. It provided the mathematical foundation that allows our dashboard to show not just what we spent, but what we will spend.

- Distillation: For the Monthly Reports (UC-009), the AI was excellent at taking raw JSON data and distilling it into a concise, professional executive summary that a human manager would actually want to read.

## Where I overrode or modified AI output

I’m a bit relaxed, but I’m not reckless. I rejected AI suggestions whenever they were too generic or "too safe" for our specific estate management needs.

- Placeholder Logic (UC-006): Initially, Claude suggested using a simple static threshold for AI alerts. I rejected this. A static threshold is lazy and doesn't account for different lift brands or usage patterns. I forced a rewrite to use dynamic velocity calculation based on real historical data, ensuring the alerts were actually meaningful.

- Generic AI Summaries (UC-009): The first version of the PDF report summary sounded like a generic corporate bot. I modified the prompt and the post-processing logic to ensure it specifically highlighted SLA compliance and cost variance, making the output actionable rather than just "nice to have."

- Security Over-Engineering: At one point, Claude suggested a complex multi-layered auth check for the report generation. I simplified this into a clean, robust Cron-Guard middleware. It’s easier to maintain, just as secure for our needs, and doesn't bloat the codebase.

## Learning & Reflection

Using AI taught me that being an "amazing coder" today is more about oversight and judgment than just typing. I learned to treat AI as a very fast intern: it’s great at the grunt work, but it needs a senior dev (me) to check its math and keep it focused on the business value. By being critical of its output, I ensured our project isn't just "AI-powered"—it's actually useful.

