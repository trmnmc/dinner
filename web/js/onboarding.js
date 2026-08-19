/**
 * onboarding.js — household setup in three short steps, completable in
 * under four minutes, one-handed (SPEC must-have).
 *
 * Collects exactly what `POST /api/households` accepts — the frozen
 * contract has no field for preferred proteins/cuisines even though the
 * SPEC's onboarding bullet mentions them; this screen does not invent a
 * request field to cover that gap (see T-015 handoff notes / contract
 * deviations). Assumed staples are offered as a short preset checklist
 * (toggle, no typing) rather than a quantity-entry form, for the same
 * one-handed reason.
 *
 * One dominant action per screen: each step has exactly one bottom-anchored
 * primary button ("Continue" / "Finish setup"). Back is a quiet secondary
 * link, never a second competing button.
 */

import { h, createChipGroup, mountPrimaryAction, announce, createErrorState } from './ui.js';
import { createHousehold, buildQuantity, ApiError } from './api.js';
import { navigate } from './router.js';

const NOVELTY_OPTIONS = [
  { value: 'stick_to_favourites', label: 'Stick to favourites' },
  { value: 'mostly_familiar', label: 'Mostly familiar' },
  { value: 'adventurous', label: 'Adventurous' },
];

// Smallest pair of ceiling values under which the shipped catalog still
// yields at least three eligible dinners (verified against data/recipes/*:
// 5 of 6 recipes clear 60 min total / 30 min active; only the 78-minute
// braise falls to the total ceiling). Defined once here so the initial
// `state` below and these option lists cannot drift apart the way the
// previous 30/15 defaults did — those excluded the entire catalog because
// the shortest recipe's active time (16 min) already exceeded 15.
const DEFAULT_TOTAL_TIME = '60';
const DEFAULT_ACTIVE_TIME = '30';

const TOTAL_TIME_OPTIONS = [
  { value: '20', label: '20 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: DEFAULT_TOTAL_TIME, label: '60 min' },
  { value: 'none', label: 'No limit' },
];

const ACTIVE_TIME_OPTIONS = [
  { value: '10', label: '10 min' },
  { value: '15', label: '15 min' },
  { value: '20', label: '20 min' },
  { value: DEFAULT_ACTIVE_TIME, label: '30 min' },
  { value: 'none', label: 'No limit' },
];

const DIETARY_OPTIONS = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' },
  { value: 'gluten_free', label: 'Gluten-free' },
  { value: 'dairy_free', label: 'Dairy-free' },
  { value: 'nut_free', label: 'Nut-free' },
  { value: 'egg_free', label: 'Egg-free' },
  { value: 'soy_free', label: 'Soy-free' },
  { value: 'shellfish_free', label: 'Shellfish-free' },
  { value: 'low_carb', label: 'Low-carb' },
];

const ALLERGY_OPTIONS = [
  { value: 'peanut', label: 'Peanut' },
  { value: 'tree_nut', label: 'Tree nut' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'egg', label: 'Egg' },
  { value: 'gluten', label: 'Gluten' },
  { value: 'wheat', label: 'Wheat' },
  { value: 'soy', label: 'Soy' },
  { value: 'fish', label: 'Fish' },
  { value: 'shellfish', label: 'Shellfish' },
  { value: 'sesame', label: 'Sesame' },
  { value: 'mustard', label: 'Mustard' },
  { value: 'sulfite', label: 'Sulfite' },
];

// Curated ids guaranteed present in data/ingredients.json — chips only ever
// emit ids the server's registry can resolve.
const NEVER_RECOMMEND_OPTIONS = [
  { value: 'cilantro', label: 'Cilantro' },
  { value: 'cremini_mushrooms', label: 'Mushrooms' },
  { value: 'feta', label: 'Feta' },
  { value: 'shrimp_peeled', label: 'Shrimp' },
  { value: 'jalapeno', label: 'Jalapeño' },
  { value: 'fish_sauce', label: 'Fish sauce' },
  { value: 'avocado', label: 'Avocado' },
  { value: 'baby_spinach', label: 'Spinach' },
];

// Preset amounts (plain integers — always parseable by buildQuantity) so
// this step is toggle-only, never a quantity-typing form.
const STAPLE_PRESETS = [
  { id: 'olive_oil', label: 'Olive oil', amount: '500', unit: 'ml', defaultOn: true },
  { id: 'kosher_salt', label: 'Salt', amount: '300', unit: 'g', defaultOn: true },
  { id: 'black_pepper', label: 'Black pepper', amount: '50', unit: 'g', defaultOn: true },
  { id: 'garlic', label: 'Garlic', amount: '6', unit: 'count', defaultOn: true },
  { id: 'yellow_onion', label: 'Onions', amount: '2', unit: 'count', defaultOn: true },
  { id: 'all_purpose_flour', label: 'Flour', amount: '1000', unit: 'g', defaultOn: false },
  { id: 'granulated_sugar', label: 'Sugar', amount: '500', unit: 'g', defaultOn: false },
  { id: 'soy_sauce', label: 'Soy sauce', amount: '250', unit: 'ml', defaultOn: false },
  { id: 'unsalted_butter', label: 'Butter', amount: '200', unit: 'g', defaultOn: false },
  { id: 'chicken_stock', label: 'Chicken stock', amount: '1000', unit: 'ml', defaultOn: false },
  { id: 'long_grain_white_rice', label: 'White rice', amount: '900', unit: 'g', defaultOn: false },
];

/**
 * @param {string} label
 * @param {string|null} hint
 * @param {HTMLElement} control
 */
function fieldWrap(label, hint, control) {
  const children = [h('span', { class: 'field__label' }, [label])];
  if (hint) children.push(h('span', { class: 'field__hint' }, [hint]));
  children.push(control);
  return h('div', { class: 'field' }, children);
}

/**
 * @param {number} initial
 * @param {number} min
 * @param {number} max
 * @param {(v: number) => void} onChange
 */
function stepperControl(initial, min, max, onChange) {
  let value = initial;
  const display = h('span', { class: 'stepper__value num' }, [String(value)]);
  const dec = h(
    'button',
    {
      type: 'button',
      class: 'stepper__btn',
      'aria-label': 'Fewer people',
      onClick: () => {
        if (value > min) {
          value -= 1;
          display.textContent = String(value);
          onChange(value);
        }
      },
    },
    ['−'],
  );
  const inc = h(
    'button',
    {
      type: 'button',
      class: 'stepper__btn',
      'aria-label': 'More people',
      onClick: () => {
        if (value < max) {
          value += 1;
          display.textContent = String(value);
          onChange(value);
        }
      },
    },
    ['+'],
  );
  return h('div', { class: 'stepper' }, [dec, display, inc]);
}

/**
 * @param {number} step - 0-based
 * @param {number} total
 * @returns {HTMLElement}
 */
function progressDots(step, total) {
  const dots = [];
  for (let i = 0; i < total; i++) {
    dots.push(
      h('span', {
        class: 'progress-dots__dot',
        dataset: { state: i < step ? 'done' : i === step ? 'current' : 'upcoming' },
      }),
    );
  }
  return h('div', { class: 'progress-dots', role: 'img', 'aria-label': `Step ${step + 1} of ${total}` }, dots);
}

/**
 * @typedef {Object} OnboardingState
 * @property {string} household_name
 * @property {number} household_size
 * @property {'stick_to_favourites'|'mostly_familiar'|'adventurous'} novelty_preference
 * @property {string} total_time
 * @property {string} active_time
 * @property {string} display_name
 * @property {string[]} dietary_restrictions
 * @property {string[]} allergies
 * @property {string[]} never_recommend
 * @property {Set<string>} staples
 */

/**
 * Mount the onboarding flow into `container`.
 * @param {HTMLElement} container
 * @returns {() => void} cleanup
 */
export function renderOnboarding(container) {
  /** @type {OnboardingState} */
  const state = {
    household_name: '',
    household_size: 2,
    novelty_preference: 'mostly_familiar',
    total_time: DEFAULT_TOTAL_TIME,
    active_time: DEFAULT_ACTIVE_TIME,
    display_name: '',
    dietary_restrictions: [],
    allergies: [],
    never_recommend: [],
    staples: new Set(STAPLE_PRESETS.filter((s) => s.defaultOn).map((s) => s.id)),
  };

  let step = 0;
  /** @type {ReturnType<typeof mountPrimaryAction>|null} */
  let primaryBar = null;
  let submitting = false;
  const TOTAL_STEPS = 3;

  function unmountPrimary() {
    if (primaryBar) {
      primaryBar.unmount();
      primaryBar = null;
    }
  }

  function stepHousehold() {
    const nameInput = h('input', {
      class: 'input',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'words',
      placeholder: 'e.g. The Riveras',
      '.value': state.household_name,
      /** @param {Event} e */
      onInput: (e) => {
        state.household_name = /** @type {HTMLInputElement} */ (e.target).value;
      },
    });

    const sizeControl = stepperControl(state.household_size, 1, 8, (v) => {
      state.household_size = v;
    });

    const novelty = createChipGroup({
      options: NOVELTY_OPTIONS,
      multi: false,
      selected: [state.novelty_preference],
      ariaLabel: 'How adventurous should dinners be',
      onChange: (sel) => {
        // NOVELTY_OPTIONS' values are exactly the three literal members of
        // OnboardingState['novelty_preference'], so a selection here can
        // only ever be one of them (or absent, hence the fallback).
        state.novelty_preference = /** @type {OnboardingState['novelty_preference']} */ (sel[0]) || 'mostly_familiar';
      },
    });

    const totalTime = createChipGroup({
      options: TOTAL_TIME_OPTIONS,
      multi: false,
      selected: [state.total_time],
      ariaLabel: 'Total time available on a weeknight',
      onChange: (sel) => {
        state.total_time = sel[0] || 'none';
      },
    });

    const activeTime = createChipGroup({
      options: ACTIVE_TIME_OPTIONS,
      multi: false,
      selected: [state.active_time],
      ariaLabel: 'Hands-on time available on a weeknight',
      onChange: (sel) => {
        state.active_time = sel[0] || 'none';
      },
    });

    return h('div', { class: 'stack' }, [
      fieldWrap('Household name', 'Optional — helps if this device is shared.', nameInput),
      fieldWrap('People eating dinner', 'Including kids.', sizeControl),
      fieldWrap('How adventurous should dinners be?', null, novelty.element),
      fieldWrap('Total time on a weeknight', '22 min total, 7 min hands-on — separated, always.', totalTime.element),
      fieldWrap('Hands-on time on a weeknight', 'Time actually at the stove, not simmering or baking.', activeTime.element),
    ]);
  }

  /** @param {() => void} revalidate */
  function stepAbout(revalidate) {
    const nameInput = h('input', {
      class: 'input',
      type: 'text',
      autocomplete: 'name',
      autocapitalize: 'words',
      placeholder: 'Your name',
      '.value': state.display_name,
      'aria-required': 'true',
      /** @param {Event} e */
      onInput: (e) => {
        state.display_name = /** @type {HTMLInputElement} */ (e.target).value;
        revalidate();
      },
    });

    const dietary = createChipGroup({
      options: DIETARY_OPTIONS,
      multi: true,
      selected: state.dietary_restrictions,
      ariaLabel: 'Dietary restrictions',
      onChange: (sel) => {
        state.dietary_restrictions = sel;
      },
    });

    const allergies = createChipGroup({
      options: ALLERGY_OPTIONS,
      multi: true,
      selected: state.allergies,
      ariaLabel: 'Allergies',
      onChange: (sel) => {
        state.allergies = sel;
      },
    });

    return h('div', { class: 'stack' }, [
      fieldWrap('What should we call you?', null, nameInput),
      fieldWrap('Dietary restrictions', 'Hard rules — never crossed, no exceptions.', dietary.element),
      fieldWrap('Allergies', 'Also a hard rule, checked before anything else.', allergies.element),
    ]);
  }

  function stepStaples() {
    const neverRecommend = createChipGroup({
      options: NEVER_RECOMMEND_OPTIONS,
      multi: true,
      selected: state.never_recommend,
      ariaLabel: 'Ingredients to never recommend',
      onChange: (sel) => {
        state.never_recommend = sel;
      },
    });

    const staplesOptions = STAPLE_PRESETS.map((s) => ({ value: s.id, label: s.label }));
    const staples = createChipGroup({
      options: staplesOptions,
      multi: true,
      selected: Array.from(state.staples),
      ariaLabel: 'Staples usually on hand',
      onChange: (sel) => {
        state.staples = new Set(sel);
      },
    });

    return h('div', { class: 'stack' }, [
      fieldWrap('Never recommend', "Dislikes, not allergies — we just won't suggest these.", neverRecommend.element),
      fieldWrap('What you usually have on hand', 'Toggle off anything that is not true today.', staples.element),
    ]);
  }

  function totalCeilingSeconds() {
    return state.total_time === 'none' ? null : parseInt(state.total_time, 10) * 60;
  }
  function activeCeilingSeconds() {
    return state.active_time === 'none' ? null : parseInt(state.active_time, 10) * 60;
  }

  function buildPayload() {
    return {
      household: {
        name: state.household_name.trim() || 'Our household',
        household_size: state.household_size,
        novelty_preference: state.novelty_preference,
        weeknight_active_time_ceiling_seconds: activeCeilingSeconds(),
        weeknight_total_time_ceiling_seconds: totalCeilingSeconds(),
      },
      member: {
        display_name: state.display_name.trim(),
        dietary_restrictions: state.dietary_restrictions,
        allergies: state.allergies,
        never_recommend_ingredients: state.never_recommend,
      },
      assumed_staples: STAPLE_PRESETS.filter((s) => state.staples.has(s.id)).map((s) => ({
        ingredient_id: s.id,
        quantity: buildQuantity(s.amount),
        unit: s.unit,
      })),
    };
  }

  async function submit() {
    // `submit` only ever runs as the mounted primary bar's own onClick
    // handler (see `draw()` below), so `primaryBar` is always set here —
    // the guard exists only to satisfy the checker, not to handle a real
    // "no bar mounted" case.
    if (submitting || !primaryBar) return;
    submitting = true;
    primaryBar.setDisabled(true);
    primaryBar.setLabel('Setting up…');
    clearError();
    try {
      await createHousehold(buildPayload());
      announce('Household set up. Moving to taste calibration.');
      navigate('/calibrate');
    } catch (err) {
      submitting = false;
      primaryBar.setDisabled(false);
      primaryBar.setLabel('Finish setup');
      showError(err instanceof ApiError ? err.message : 'Could not set up your household. Please try again.');
    }
  }

  /** @type {HTMLElement|null} */
  let errorHost = null;

  function clearError() {
    if (errorHost) {
      errorHost.replaceChildren();
    }
  }

  /** @param {string} message */
  function showError(message) {
    if (!errorHost) return;
    errorHost.replaceChildren(createErrorState({ title: 'Setup did not go through', message }));
    announce(message, { assertive: true });
  }

  function draw() {
    unmountPrimary();
    clearError();

    const heading = h('h1', { class: 'screen-header__title', tabindex: '-1' }, [
      step === 0 ? 'Your household' : step === 1 ? 'About you' : 'A few more things',
    ]);

    const isValid = () => (step === 1 ? state.display_name.trim().length > 0 : true);

    const revalidate = () => {
      // Only wired up as the step-2 name input's onInput handler while its
      // primary bar is mounted (see `stepAbout` below) — never called
      // before `primaryBar` is set.
      if (!primaryBar) return;
      primaryBar.setDisabled(!isValid());
    };

    let bodyEl;
    if (step === 0) bodyEl = stepHousehold();
    else if (step === 1) bodyEl = stepAbout(revalidate);
    else bodyEl = stepStaples();

    errorHost = h('div', {});

    const header = [
      h('div', { class: 'screen-header' }, [
        h('span', { class: 'screen-header__eyebrow' }, ['Setup']),
        heading,
        h('p', { class: 'screen-header__subtitle' }, [
          step === 0
            ? 'A few taps, then three dinners you actually want.'
            : step === 1
              ? 'Hard limits first — allergies and restrictions never bend.'
              : 'Optional. Skip anything that does not apply.',
        ]),
      ]),
      progressDots(step, TOTAL_STEPS),
    ];

    const backLink =
      step > 0
        ? h(
            'button',
            {
              type: 'button',
              class: 'back-link',
              onClick: () => {
                step -= 1;
                draw();
              },
            },
            ['Back'],
          )
        : null;

    container.replaceChildren(h('div', { class: 'screen' }, [backLink, ...header, bodyEl, errorHost]));

    heading.focus({ preventScroll: true });

    primaryBar = mountPrimaryAction({
      label: step < TOTAL_STEPS - 1 ? 'Continue' : 'Finish setup',
      disabled: !isValid(),
      onClick: () => {
        if (!isValid()) return;
        if (step < TOTAL_STEPS - 1) {
          step += 1;
          draw();
        } else {
          submit();
        }
      },
    });
  }

  draw();

  return () => {
    unmountPrimary();
  };
}
