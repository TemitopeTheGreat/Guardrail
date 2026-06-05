# CLAUDE.md – Frontend Website Rules

## ## Always Do First
- **Invoke the 4-Skill Stack** (`guardrail-copywriter`, `guardrail-ui-engineer`, `guardrail-data-engine`, `guardrail-compliance-engine`) before writing any frontend code, every session[cite: 3].
- Review `guardrail_sme_strategy_v2.pdf` and `guardrail_sme_guidelines_v2.pdf` to ensure compliance with the core platform logic and business model.

## ## Local Server
- **Always serve on localhost** – run the development server via `npm run dev`.
- Make sure the development server is running in your VS Code terminal background before taking any coding actions.

## ## Project Stack Defaults
- Framework: Vite + React (JavaScript components).
- Utility Styling: Tailwind CSS.
- Icons: Lucide React vector icons.
- Responsiveness: Mobile-first responsive grid mappings.

## ## Anti-Generic Guardrails
- **Colors:** Never use raw default Tailwind blues or indigos as primary colors. Stick to Deep Slate (`#020617`) for base layers, with Electric Mint (`#34D399`) highlighting successful/verified data states, and technical Indigo accents for active tool selectors[cite: 5, 8].
- **Typography:** Enforce strict hierarchy. Use clean geometric sans-serif for content headers, but strictly pair them with monospaced text configurations (`font-mono`) for all financial charts, ledger metrics, numerical entries, and calculations to ensure complete data layout integrity[cite: 5, 8].
- **Animations:** Only animate `transform` and `opacity`. Never use heavy, unoptimized global transition sweeps.
- **Interactive States:** Every clickable asset needs distinct active, focus-visible, and hover metrics (`hover:scale-[1.01] transition-all duration-300`)[cite: 5, 8].
- **Depth & Surfaces:** Enforce an intentional layout layering matrix (Base canvas background → Elevated card wrappers → Floating action submenus/dialogs) using glassmorphism borders (`border-slate-800 bg-slate-900/50 backdrop-blur-md`)[cite: 5, 8].

## ## Core Feature Architecture Rules
1. **Audit & Data Cleaner:** Maintain states (`useState`) representing raw data cleaning logs. Verify that Total Debits strictly balance Total Credits ($\sum \text{Debits} = \sum \text{Credits}$). Render clean log text strings showing real-time error corrections[cite: 5].
2. **Expense & Analysis Matrix:** Build toggles that split views cleanly between overall multi-station expenses, flagged budget variances, and clean tax filing prep groups.
3. **Financial Goal Tracker:** Render progress containers that scale based on transactional balances, showing immediate warning colors if spending passes designated boundaries.

## ## Hard Rules
- Do not build random sections or features outside our primary SME/Individual product blueprint[cite: 3].
- Do not "improve" layout styling using generic tech components – maintain the custom elite dark fintech look[cite: 5, 8].