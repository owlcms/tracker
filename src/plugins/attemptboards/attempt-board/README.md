# Attempt Board

Full-screen display showing the current athlete with weight, barbell plates visualization, timer, and referee decisions. Matches the OWLCMS Attempt Board layout.

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ HOLME                                                           │
│ Ragnar G.                                                       │
│ Tambarskjelvar IL                                               │
├────────┬──────────────┬─────────────────────────┬───────────────┤
│  [3]   │  SM >109     │                         │  C. & J. #2   │
├────────┴──────────────┤   ══╦════════════╦══    ├───────────────┤
│ 208 kg                │     ║▓▓▓▓▓▓▓▓▓▓▓▓║      │    2:00       │
└───────────────────────┴─────────────────────────┴───────────────┘
```

- **Top section**: Athlete name (cyan), first name (white), team (italic)
- **Middle left**: Start number in red box, category
- **Middle center**: Barbell with plates visualization
- **Middle right**: Attempt label (e.g., "C. & J. #2")
- **Bottom left**: Weight in kg (large, cyan)
- **Bottom center**: Plates continue
- **Bottom right**: Timer (yellow when running)

## Decision Display

When referees give decisions, the plates/timer area is replaced with:

1. **Down signal**: Large green down arrow (▼)
2. **Referee lights**: Three circles (white = good, red = no lift), or only the middle one for a single referee

With OWLCMS 69 the cells are drawn from `decisionState`, as computed by OWLCMS (nothing is re-derived):

- **Referee cells**: `empty`, `voted` (gray), `white`, `red`.
- **Jury circles**: one per juror below the referee cells, same states, when `showJuryVotes` is on.
- **Review break** (jury deliberation, adjudication panel review, challenge): the decision area is shown when a review vote is open or cells are shown. The break message becomes the review label (`PublicMsg.JuryDeliberation`, `PublicMsg.AdjudicationPanelReview` or `PublicMsg.CHALLENGE`).
- **Jury card**: after a jury Good Lift / No Lift (`adjudicationDecision`, not for Speaker-only notifications) a card shows Reversal / Confirmed, the decision ("New Record!" instead of Good Lift when the decision makes a record), athlete, judged attempt and, for a No Lift, the rule (`<code> - Jury.incorrect.<code>`). It stays for `juryCardSeconds`, counted from the arrival of the decision.

With an older OWLCMS (no `decisionState`) only the referee decision is shown, as before.

## Introductions and countdowns

Ceremonies can overlay `FIRST_SNATCH`; they do not require `breakType: CEREMONY`.
The board shows the athletes' or officials' introduction title while the ceremony mode is active.
Athletes' introduction has no countdown, weight or barbell. Officials' introduction keeps the running
break countdown visible but hides the weight and barbell. Ending the ceremony restores the before-snatch
title and loading display without restarting the countdown. A timer with no valid countdown is hidden,
not shown as `0:00`.

## Plate Visualization

Plates are calculated from the platform configuration stored in the OWLCMS database:

- **Large plates (bumper)**: 25kg (red), 20kg (blue), 15kg (yellow), 10kg (green), 5kg (white), 2.5kg (red)
- **Collar**: 2.5kg (black with white border)
- **Small plates (change)**: 5kg, 2.5kg, 2kg, 1.5kg, 1kg, 0.5kg

Bar weight is automatically determined by gender (20kg men, 15kg women) or platform configuration.

## URL Parameters

```
/attempt-board?fop=A&showPlates=true&showTimer=true&showDecisions=true&showFlag=false
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `fop` | `A` | Field of Play name |
| `showPlates` | `true` | Show barbell plate visualization |
| `showTimer` | `true` | Show countdown timer |
| `showDecisions` | `true` | Show referee decision lights |
| `showJuryVotes` | `auto` | `true`/`false` show or hide the jury circles; `auto` follows the OWLCMS "jury decisions on attempt board" setting (`juryDecisionsOnAttemptBoard`) |
| `juryCardSeconds` | `5` | Seconds the jury Good Lift / No Lift card stays on screen, `0` turns it off |
| `showFlag` | `false` | Show team/country flag |

## Data Source

Uses session athlete data from OWLCMS WebSocket updates:
- Current athlete identified by `classname: "current"`
- Weight from `fopUpdate.weight`
- Platform plate configuration from `database.platforms`
