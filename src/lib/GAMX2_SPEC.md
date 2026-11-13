# GAMX JavaScript Implementation Specification

## Overview

JavaScript implementation of the GAMX scoring system using Box-Cox Cole and Green (BCCG) distribution. This is a direct port of OWLCMS GAMX2.java, matching R's `gamlss.dist::pBCCG` exactly.

## Formula

```
GAMX = qnorm(pBCCG(total, μ, σ, ν)) × 100 + 1000
```

Where:
- `total` = lifted weight in kg
- `μ`, `σ`, `ν` = BCCG distribution parameters (interpolated from body mass)
- `pBCCG()` = **truncated/normalized** CDF (cumulative distribution function) of the BCCG distribution
- `qnorm()` = inverse of the standard normal CDF (quantile function)

### pBCCG Detail (from R gamlss.dist)

The BCCG CDF uses truncation and normalization:

```javascript
z = ((y/μ)^ν - 1) / (ν × σ)     for ν ≠ 0
z = log(y/μ) / σ                 for ν → 0

FYy1 = Φ(z)
FYy2 = Φ(-1/(σ×|ν|))   if ν > 0, else 0
FYy3 = Φ(1/(σ×|ν|))

p = (FYy1 - FYy2) / FYy3
```

**Critical:** Without truncation/normalization, scores will be off by ~200 points.

## Parameter Tables

Parameter files loaded from `src/lib/gamx/`:

| Variant | Men File | Women File | Usage |
|---------|----------|------------|-------|
| SENIOR | `params-sen-men.js` | `params-sen-wom.js` | Standard GAMX for seniors |
| AGE_ADJUSTED | `params-iwf-men.js` | `params-iwf-wom.js` | GAMX-A for age-adjusted (13-40) |
| U17 | `params-usa-men.js` | `params-usa-wom.js` | GAMX-U for U17 athletes |
| MASTERS | `params-mas-men.js` | `params-mas-wom.js` | GAMX-M for masters athletes |

### Parameter Format

**Body-mass-only variants (SENIOR, U17):**
```javascript
export const GAMX_PARAMS_SEN_MEN = [
    [40.0, 123.45, 0.085, 4.2],  // [bodyMass, mu, sigma, nu]
    [41.0, 125.67, 0.084, 4.1],
    // ...
];
```

**Age-dependent variants (MASTERS):**
```javascript
export const GAMX_PARAMS_MAS_MEN = [
    [30, 40.0, 115.17, 0.0835, 2.57],  // [age, bodyMass, mu, sigma, nu]
    [30, 40.1, 115.48, 0.0835, 2.56],
    // ...
    [58, 69.0, 163.77, 0.1055, 0.53],
    // ...
    [95, 190.0, 54.42, 0.2197, -2.88]
];
```

**Age ranges by variant:**
- MASTERS: ages 30-95
- AGE_ADJUSTED: ages 13-40

## Algorithms

### 1. Parameter Interpolation

#### Body-Mass-Only Variants (SENIOR, U17)

Given `gender` ("M" or "F") and `bodyMass`:

1. Select parameter table based on gender and variant
2. **Clamp** body mass to table range `[min_bm, max_bm]`
3. Find bracketing rows where `table[low][0] <= bodyMass <= table[high][0]`
4. If exact match, use values directly
5. Otherwise, linear interpolation:

```javascript
const lowRatio = bodyMass - low[0];
const highRatio = high[0] - bodyMass;
const denom = lowRatio + highRatio;

const mu = (highRatio * low[1] + lowRatio * high[1]) / denom;
const sigma = (highRatio * low[2] + lowRatio * high[2]) / denom;
const nu = (highRatio * low[3] + lowRatio * high[3]) / denom;
```

#### Age-Dependent Variants (MASTERS)

Given `gender`, `bodyMass`, and `age`:

1. Select parameter table based on gender
2. **Clamp age to table bounds** (critical for correct scoring):
   - MASTERS: clamp to `[30, 95]` (e.g., age 25 → 30)
3. **Binary search** to find first row matching `normalizedAge`
4. **Expand** to find all rows with same age (using `normalizedAge`, not original `age`)
5. Extract body-mass rows for that age, convert to `[bodyMass, mu, sigma, nu]` format
6. Use the row at the body mass rounded to 0.1 kg (R's `round(x, 1)`, as in the reference online
   calculators). Interpolation as above is kept behind `INTERPOLATE_AGE_TABLES` (currently `false`).
   SENIOR tables are always interpolated.

```javascript
// CRITICAL: Use normalizedAge (clamped) not original age when expanding rows
let lastAgeIdx = firstAgeIdx;
while (lastAgeIdx + 1 < params.length && 
       Math.abs(params[lastAgeIdx + 1][0] - normalizedAge) < 0.01) {
    lastAgeIdx++;
}
```

**Why age clamping matters:** A 25-year-old competing in MASTERS uses age 30 parameters (the youngest in table). Without clamping, the algorithm fails to find rows → wrong results. Verified: age 25 at 69kg/140kg gives GAMX 603.13 (same as age 30), not 857.35 (which is age 58).

### 2. BCCG CDF (pBCCG)

Truncated and normalized Box-Cox transformation matching R's implementation:

```javascript
function pBCCG(y, mu, sigma, nu) {
    // Box-Cox transformation to z-score
    let z;
    if (Math.abs(nu) < 1e-10) {
        // Limiting case: log-normal
        z = Math.log(y / mu) / sigma;
    } else {
        // General case: Box-Cox power
        z = (Math.pow(y / mu, nu) - 1.0) / (nu * sigma);
    }
    
    // Truncation and normalization
    const FYy1 = normalCdf(z);
    const FYy2 = nu > 0 ? normalCdf(-1.0 / (sigma * Math.abs(nu))) : 0.0;
    const FYy3 = normalCdf(1.0 / (sigma * Math.abs(nu)));
    
    return (FYy1 - FYy2) / FYy3;
}
```

### 3. Normal Distribution Functions

**Standard Normal CDF (Φ)**:
```javascript
function normalCdf(x) {
    return 0.5 * (1.0 + erf(x / Math.sqrt(2)));
}
```

Uses error function with Cody's rational Chebyshev approximation (accuracy ~1e-15).

**Inverse Normal CDF (qnorm)**:
```javascript
function normalQuantile(p) {
    // Rational approximation from Abramowitz and Stegun
    // with Halley refinement for precision ~1e-15
}
```

### 4. GAMX Computation

```javascript
export function computeGamx(gender, bodyMass, total, variant = Variant.SENIOR) {
    // 1. Validate inputs
    // 2. Get parameter table for gender and variant
    // 3. Interpolate parameters from body mass
    // 4. Compute p = pBCCG(total, mu, sigma, nu)
    // 5. Compute z = normalQuantile(p)
    // 6. Return z * 100 + 1000
}
```

### 5. kgTarget Algorithm (Inverse Problem)

Find the **minimum** total (in kg) that **strictly exceeds** target GAMX at 2 decimal precision.

**Purpose:** When two athletes with identical age, gender, bodyweight compete, one with GAMX score X, the other needs `kgTarget(X)` to guarantee a win (no ties at 2 decimals).

**Algorithm:**

1. **Convert target GAMX to probability**:
   ```javascript
   const z = (targetGAMX - 1000.0) / 100.0;
   const p = normalCdf(z);
   ```

2. **Compute initial estimate using qBCCG**:
   ```javascript
   const formulaResult = qBCCG(p, mu, sigma, nu);
   ```

3. **Find minimum integer using decrement test**:
   ```javascript
   // Start with ceiling of estimate (likely exceeds target)
   let candidate = Math.ceil(formulaResult);
   const targetRounded = Math.round(targetGAMX * 100) / 100;
   
   // If candidate doesn't exceed, increment until it does
   while (candidate < 600) {
       const gamxAtCandidate = computeGamxCore(candidate, mu, sigma, nu);
       const gamxRounded = Math.round(gamxAtCandidate * 100) / 100;
       if (gamxRounded > targetRounded) break;
       candidate++;
   }
   
   // Decrement to find minimum that still exceeds
   while (candidate > 1) {
       const test = candidate - 1;
       const gamxAtTest = computeGamxCore(test, mu, sigma, nu);
       const gamxRounded = Math.round(gamxAtTest * 100) / 100;
       if (gamxRounded > targetRounded) {
           candidate = test;  // Still exceeds, keep going lower
       } else {
           break;  // test doesn't exceed, candidate is minimum
       }
   }
   return candidate;
   ```

**Why decrement test instead of binary search:** Since GAMX is monotonically increasing with total, we can simply start with a value that exceeds and decrement until we find the boundary. This guarantees finding the absolute minimum.

### 6. qBCCG Implementation (from R gamlss.dist)

Inverse CDF of BCCG distribution - given probability p, returns total y:

```javascript
function qBCCG(p, mu, sigma, nu) {
    if (p <= 0 || p >= 1) return NaN;
    
    // Adjust probability for truncation (inverse of pBCCG normalization)
    let pAdjusted;
    if (nu <= 0) {
        pAdjusted = p * normalCdf(1.0 / (sigma * Math.abs(nu)));
    } else {
        pAdjusted = 1.0 - (1.0 - p) * normalCdf(1.0 / (sigma * Math.abs(nu)));
    }
    
    // Convert adjusted probability to z-score
    const z = normalQuantile(pAdjusted);
    
    // Inverse Box-Cox transformation
    let total;
    if (Math.abs(nu) < 1e-10) {
        // Limiting case: log-normal
        total = mu * Math.exp(sigma * z);
    } else {
        // General case: power transformation
        total = mu * Math.pow(nu * sigma * z + 1.0, 1.0 / nu);
    }
    
    return total;
}
```

## API

### Main Functions

```javascript
/**
 * Compute GAMX score
 * @param {string} gender - 'M' or 'F'
 * @param {number} bodyMass - Body mass in kg
 * @param {number} total - Total lifted in kg
 * @param {string} variant - Parameter variant (default: SENIOR)
 * @param {number|null} age - Age (required for MASTERS variant)
 * @returns {number} GAMX score, or 0 if invalid
 */
export function computeGamx(gender, bodyMass, total, variant = Variant.SENIOR, age = null)

/**
 * Find minimum total that strictly exceeds target GAMX
 * @param {string} gender - 'M' or 'F'
 * @param {number} targetScore - Target GAMX score to exceed
 * @param {number} bodyMass - Body mass in kg
 * @param {string} variant - Parameter variant (default: SENIOR)
 * @param {number|null} age - Age (required for MASTERS variant)
 * @returns {number} Minimum total in kg, or 0 if impossible
 */
export function kgTarget(gender, targetScore, bodyMass, variant = Variant.SENIOR, age = null)
```

### Convenience Functions

```javascript
export function computeGamxA(gender, bodyMass, total, age)  // AGE_ADJUSTED (age required, 13-40)
export function computeGamxU(gender, bodyMass, total)  // U17
export function computeGamxM(gender, bodyMass, total, age)  // MASTERS (age required, 30-95)
```

**Note:** For SENIOR variant, use the main `computeGamx()` function which defaults to SENIOR.

## Testing

Test file: `src/lib/gamx2.test.js`

Run with: `node src/lib/gamx2.test.js`

### Test Suites

1. **GAMX Computation Tests** (20 cases)
   - Men: 10 reference values from R implementation
   - Women: 10 reference values from R implementation
   - Tolerance: ±0.1 GAMX points

2. **kgTarget Tests** (10 cases)
   - Verifies returned total meets or exceeds target
   - Tests both men and women
   - Validates 2 decimal precision comparison

3. **Strict Exceed Tests** (4 cases)
   - Simulates competition scenario: opponent achieves GAMX X
   - Verifies `kgTarget(X)` returns total producing GAMX > X at 2 decimals
   - Ensures no ties allowed

### Reference Test Cases

**Men:**
| bodyMass | total | Expected GAMX |
|----------|-------|---------------|
| 55.0 | 200 | 827.08 |
| 61.0 | 250 | 892.88 |
| 67.0 | 280 | 916.85 |
| 73.0 | 310 | 961.73 |
| 81.0 | 340 | 1020.74 |
| 89.0 | 370 | 1094.89 |
| 96.0 | 390 | 1134.51 |
| 102.0 | 410 | 1183.90 |
| 109.0 | 430 | 1230.90 |
| 120.0 | 450 | 1300.98 |

**Women:**
| bodyMass | total | Expected GAMX |
|----------|-------|---------------|
| 45.0 | 130 | 842.70 |
| 49.0 | 160 | 929.82 |
| 55.0 | 180 | 951.52 |
| 59.0 | 195 | 979.08 |
| 64.0 | 210 | 1008.47 |
| 71.0 | 230 | 1048.06 |
| 76.0 | 245 | 1083.84 |
| 81.0 | 255 | 1112.91 |
| 87.0 | 270 | 1190.52 |
| 100.0 | 290 | 1263.83 |

## Key Implementation Insights

### From R Source (gamlss.dist)

1. **pBCCG truncation/normalization**: The formula `p = (Φ(z) - FYy2) / FYy3` with truncation bounds was extracted from R source code. This was critical - without it, scores were off by ~200 points.

2. **qBCCG probability adjustment**: The inverse function adjusts probability differently based on sign of ν:
   - `ν ≤ 0`: `p' = p × Φ(1/(σ|ν|))`
   - `ν > 0`: `p' = 1 - (1-p) × Φ(1/(σ|ν|))`

3. **Box-Cox limiting case**: When `|ν| < 1e-10`, use log-normal transformation instead of power transformation to avoid numerical instability.

4. **2 decimal precision**: All comparisons for kgTarget use `Math.round(value * 100) / 100` to ensure consistent behavior and avoid floating-point precision issues causing false ties.

### Age Clamping Bug (Critical)

When implementing age-dependent variants, a subtle bug can occur in the row expansion loop:

```javascript
// BUG: Uses original age (25) instead of normalizedAge (30)
while (lastAgeIdx + 1 < params.length && 
       Math.abs(params[lastAgeIdx + 1][0] - age) < 0.01) {  // ❌ WRONG
    lastAgeIdx++;
}

// FIX: Use normalizedAge after clamping
while (lastAgeIdx + 1 < params.length && 
       Math.abs(params[lastAgeIdx + 1][0] - normalizedAge) < 0.01) {  // ✅ CORRECT
    lastAgeIdx++;
}
```

**Symptom:** kgTarget returns wrong values. For age 25 at 69kg targeting GAMX 857.35, the bug returns ~100kg instead of correct ~193kg.

**Root cause:** Binary search finds age 30 rows correctly (due to clamping), but the expansion loop compares against original age 25, finding no matches → only one row used → wrong interpolation.

**Test case to catch this bug:**
```javascript
// Age 58 athlete lifts 140kg → GAMX 857.35
// Age 25 (normalized to 30) must lift MORE to match, not less
const target25 = kgTarget('M', 857.35, 69, Variant.MASTERS, 25);
assert(target25 > 140, '25-year-old must lift MORE than 58-year-old to match GAMX');
// Expected: ~193kg (verified against R Docker API)
```

## Differences from Java Implementation

The JavaScript implementation is functionally identical to Java GAMX2, with these minor differences:

1. **Language syntax**: JavaScript uses `const`/`let`, `Math.pow()` instead of Java's `final`, `Math.pow()`
2. **Normal distribution**: Custom implementations of erf/normalCdf/normalQuantile instead of Apache Commons Math
3. **Module system**: ES6 modules (`export`/`import`) instead of Java packages
4. **Error handling**: Returns 0 for invalid inputs instead of throwing exceptions
5. **Type checking**: Runtime validation instead of compile-time type safety

**Result:** Both implementations produce identical GAMX scores (tolerance < 0.01) and identical kgTarget results.
