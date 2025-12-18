Peg33 iPhone (offline)

Goal: play with Mac OFF.

Best workflow (no coding on phone):
1) AirDrop the whole folder `peg33_ios_pwa` to your iPhone.
   - Choose: “Save to Files” (On My iPhone).
2) Open `index.html` from Files → Share → “Add to Home Screen”.
   (Safari will create an icon; open from there next time.)

Notes:
- Modes are OFF by default. Open “Modes & Settings” and enable:
  * Auto-check winnable
  * Trainer
  * Challenge (3 lives)
- Auto-solve and checks run in a WebWorker, so the UI stays responsive.
- If Safari shows “winnable?” it means the solver hit the time budget.
  Increase Check budget if you want deeper checks.
