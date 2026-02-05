# UI_IMPROVEMENTS_BATCH1.md

## Overview
A batch of UI/UX improvements to make ClawControl feel more polished and consistent.

---

## 1. Replace Right Sidebars with Centered Modal Overlays

### Problem
Right sidebars feel cramped and don't utilize available screen space well.

### Solution
Replace all right-slide panels with centered modal overlays:
- Blurred background (backdrop-blur)
- Centered content panel (max-width based on content type)
- X button at top-right to close
- Click outside to close (optional, but recommended)
- Escape key to close

### Files to Update
```
apps/clawcontrol/components/
├── ui/sheet.tsx           # Current sidebar implementation
├── ui/modal.tsx           # Create new or enhance existing
└── ...

# Find all usages of Sheet/sidebar pattern:
grep -r "Sheet" apps/clawcontrol/
grep -r "sidebar" apps/clawcontrol/
```

### Design Spec
```tsx
<Modal>
  <ModalOverlay className="bg-black/50 backdrop-blur-sm" />
  <ModalContent className="bg-bg-1 border border-bd-0 rounded-lg shadow-xl max-w-2xl mx-auto">
    <ModalHeader className="flex justify-between items-center p-4 border-b border-bd-0">
      <h2>{title}</h2>
      <button onClick={onClose}>
        <X className="w-5 h-5" />
      </button>
    </ModalHeader>
    <ModalBody className="p-4">
      {children}
    </ModalBody>
  </ModalContent>
</Modal>
```

### Acceptance Criteria
- [ ] All right sidebars converted to centered modals
- [ ] Consistent blur effect on backdrop
- [ ] X button closes modal
- [ ] Escape key closes modal
- [ ] Smooth open/close animations (fade + scale)

---

## 2. Models Page: Add New Models via UI

### Problem
Users can't add new models from the UI — only via CLI.

### Solution
Add "Add Model" flow that:
1. Shows list of available models/providers
2. User selects provider (OpenAI, Anthropic, Google, etc.)
3. User chooses auth method:
   - API Key (paste key)
   - OAuth (if available — opens browser flow)
4. Backend runs the equivalent CLI commands
5. Model appears in list

### Implementation
```
# CLI commands to wrap:
openclaw configure --section models
openclaw auth add <provider>

# New API endpoints:
POST /api/openclaw/models/add
  body: { provider, authMethod, apiKey? }
  
GET /api/openclaw/models/available
  returns: list of supported providers with auth options
```

### UI Flow
1. Click "Add Model" button
2. Modal opens with provider grid (OpenAI, Anthropic, Google, xAI, etc.)
3. Select provider → shows auth options
4. For API Key: input field + "Add" button
5. For OAuth: "Connect with {Provider}" button → opens OAuth flow
6. On success: toast + model appears in list

### Files to Create/Update
```
apps/clawcontrol/
├── app/(dashboard)/models/
│   ├── components/
│   │   ├── add-model-modal.tsx    # NEW
│   │   └── provider-card.tsx      # NEW
│   └── page.tsx                   # Add button
├── app/api/openclaw/models/
│   ├── add/route.ts               # NEW
│   └── available/route.ts         # NEW
└── lib/openclaw/
    └── models.ts                  # Add CLI wrapper functions
```

### Acceptance Criteria
- [ ] "Add Model" button on models page
- [ ] Modal shows available providers
- [ ] API key flow works
- [ ] OAuth flow works (where supported)
- [ ] New model appears in list after adding
- [ ] Error handling for invalid keys

---

## 3. Fix White Border Buttons

### Problem
Some buttons have white borders that look inconsistent with the design system.

### Solution
Audit all buttons and standardize on the dark grey border style.

### Investigation
```bash
# Find white border definitions
grep -r "border-white\|border-\[#fff\]\|border-\[white\]" apps/clawcontrol/
grep -r "border-color.*white\|borderColor.*white" apps/clawcontrol/

# Check button variants in UI library
cat apps/clawcontrol/components/ui/button.tsx
```

### Fix
Update button variants to use consistent border:
```tsx
// BAD
className="border border-white"
className="border-white"

// GOOD  
className="border border-bd-1"  // Uses design token
className="border border-zinc-700"  // Or explicit dark grey
```

### Files to Update
```
apps/clawcontrol/components/ui/button.tsx  # Check variants
apps/clawcontrol/                          # Global search for white borders
```

### Acceptance Criteria
- [ ] No white borders on any buttons
- [ ] All buttons use `border-bd-0` or `border-bd-1` tokens
- [ ] Consistent look across all pages

---

## 4. Cron Page: Instant Navigation with Loading State

### Problem
Clicking "Cron" in nav feels slow — page waits for data before rendering.

### Solution
Navigate immediately, show loading skeleton, then populate data.

### Current Behavior
```
Click Cron → wait → wait → page appears with data
```

### Desired Behavior
```
Click Cron → page appears instantly with "Loading crons..." → data populates
```

### Implementation
Use the same pattern as Models page:
```tsx
// cron/page.tsx
export default function CronPage() {
  return (
    <Suspense fallback={<CronSkeleton />}>
      <CronContent />
    </Suspense>
  )
}

function CronSkeleton() {
  return (
    <div className="p-6">
      <PageHeader title="Cron Jobs" />
      <div className="flex items-center gap-2 text-fg-3">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading crons...</span>
      </div>
    </div>
  )
}
```

### Files to Update
```
apps/clawcontrol/app/(dashboard)/cron/
├── page.tsx          # Add Suspense boundary
├── cron-client.tsx   # Move data fetching here
└── loading.tsx       # Add loading skeleton (Next.js convention)
```

### Acceptance Criteria
- [ ] Page navigates instantly on click
- [ ] Loading state shows immediately
- [ ] Data populates when ready
- [ ] Same pattern as Models page

---

## 5. /now Page: Fix Card Icons

### Problem
Cards on /now page have tiny icons that look off. Inconsistent sizing and centering.

### Solution
Create a canonical card component with properly sized, centered icons.

### Investigation
```bash
# Check current implementation
cat apps/clawcontrol/app/\(dashboard\)/now/page.tsx
cat apps/clawcontrol/app/\(dashboard\)/now/components/*.tsx
```

### Design Spec
```tsx
// Canonical stat/metric card
<MetricCard>
  <div className="flex items-center gap-4">
    <div className="w-12 h-12 rounded-lg bg-bg-2 flex items-center justify-center">
      <Icon className="w-6 h-6 text-fg-2" />
    </div>
    <div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-fg-3">{label}</div>
    </div>
  </div>
</MetricCard>

// Or for icon-only emphasis:
<MetricCard>
  <div className="flex flex-col items-center text-center p-4">
    <div className="w-14 h-14 rounded-xl bg-bg-2 flex items-center justify-center mb-3">
      <Icon className="w-7 h-7 text-accent" />
    </div>
    <div className="text-2xl font-semibold">{value}</div>
    <div className="text-sm text-fg-3">{label}</div>
  </div>
</MetricCard>
```

### Rules for Card Icons
1. **Minimum icon size:** 24x24 (w-6 h-6)
2. **Icon container:** Always use a container div with padding
3. **Container size:** At least 48x48 (w-12 h-12) 
4. **Centering:** Use `flex items-center justify-center`
5. **Background:** Subtle bg (bg-bg-2) to make icon pop
6. **Border radius:** Match card radius (rounded-lg or rounded-xl)

### Files to Update
```
apps/clawcontrol/
├── components/ui/metric-card.tsx   # Create canonical component
├── app/(dashboard)/now/
│   ├── page.tsx
│   └── components/
│       └── stat-cards.tsx          # Update to use canonical
```

### Acceptance Criteria
- [ ] All card icons are at least 24x24
- [ ] Icons have proper container with background
- [ ] Icons are visually centered
- [ ] Consistent across all cards on /now
- [ ] Reusable MetricCard component created

---

## Summary Checklist

- [ ] **Modals:** Replace all right sidebars with centered overlays
- [ ] **Models:** Add "Add Model" flow with provider selection + auth
- [ ] **Buttons:** Remove all white borders, use design tokens
- [ ] **Cron:** Instant nav + loading state
- [ ] **Cards:** Fix icon sizing with canonical MetricCard component

## Priority Order
1. White borders (quick fix, high visual impact)
2. Cron loading (quick fix, improves perceived performance)
3. Card icons (medium effort, improves /now page)
4. Modals (medium effort, affects multiple pages)
5. Add Models (larger feature, highest value)
