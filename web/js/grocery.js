/**
 * grocery.js — the grocery list as a receipt-style ledger with provenance
 * drawers and protected user edits (T-017).
 *
 * Data flow: `GET /api/plans/current` resolves the household's latest plan,
 * then `GET /api/plans/:planId/grocery` returns the ledger, grouped by
 * store section server-side (already sorted). Every non-"to taste" line
 * carries a `provenance` block naming EVERY contributing recipe and its
 * amount — the drawer opened from each row renders all of them, not a
 * sample (DoD 5's traceability must-have).
 *
 * User edits live in the separate `user_edited_quantity` column
 * (frozen contract). This screen never overwrites that column with a
 * generated value — regeneration (a fresh `GET`) only ever touches the
 * computed columns server-side, so an edited line keeps showing the
 * user's number after list regeneration. Editing or resetting a quantity
 * applies immediately and offers `showUndoSnackbar` — never a confirm()
 * dialog, matching every other screen in this product.
 *
 * Confirmation questions and "to taste" items have no answer/edit endpoint
 * in the frozen contract, so they are surfaced as honest, read-only
 * information (inline strip for questions, a tappable read-only drawer for
 * "to taste" provenance) rather than inventing an interaction the server
 * cannot honour.
 */

import {
  h,
  icon,
  openSheet,
  showUndoSnackbar,
  mountPrimaryAction,
  createLoadingState,
  createErrorState,
  createEmptyState,
  announce,
} from './ui.js';
import { getGroceryList, patchGroceryLine, getCurrentPlan, buildQuantity, formatQuantity, ApiError } from './api.js';
import { navigate } from './router.js';

/**
 * @typedef {{n: string, d: string}} Qty
 * @typedef {{recipe_id: string, recipe_name: string, amount: Qty, unit: string}} Contribution
 * @typedef {{contributions: Contribution[], inventory_deducted: Qty, expected_surplus: Qty}} Provenance
 * @typedef {{
 *   line_id: string,
 *   ingredient_id: string,
 *   display_name: string,
 *   section: string,
 *   purchase_quantity: Qty,
 *   unit: string,
 *   package_label: string|null,
 *   is_estimate: boolean,
 *   user_edited_quantity: Qty|null,
 *   checked: boolean,
 *   provenance: Provenance,
 * }} GroceryLine
 * @typedef {{section: string, lines: GroceryLine[]}} GrocerySection
 * @typedef {{ingredient_id: string, display_name: string, recipe_names: string[]}} ToTasteItem
 * @typedef {{ingredient_id: string, display_name: string, needed: Qty, believed_on_hand: Qty, unit: string, question: string}} ConfirmationQuestion
 * @typedef {{list_id: string, sections: GrocerySection[], to_taste: ToTasteItem[], confirmation_questions: ConfirmationQuestion[]}} GroceryListView
 */

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sectionLabel(section) {
  return String(section)
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function isZero(qty) {
  return qty.n === '0';
}

/**
 * Mount the grocery list into `container`.
 * @param {HTMLElement} container
 * @param {Record<string, string>} [_params] - unused: `#/grocery` takes no
 *   dynamic segments; the current plan is resolved via `getCurrentPlan()`.
 * @returns {() => void} cleanup
 */
export function renderGrocery(container, _params) {
  let destroyed = false;
  let primaryBar = null;
  let currentSheet = null;
  let snackbarHandle = null;
  let planId = null;

  /** @type {Map<string, GroceryLine>} */
  const lineIndex = new Map();
  /** @type {Map<string, HTMLElement>} */
  const rowElements = new Map();

  function unmountPrimary() {
    if (primaryBar) {
      primaryBar.unmount();
      primaryBar = null;
    }
  }

  function closeSheet() {
    if (currentSheet) {
      currentSheet.close({ immediate: true });
      currentSheet = null;
    }
  }

  function dismissSnackbar() {
    if (snackbarHandle) {
      snackbarHandle.dismiss({ immediate: true });
      snackbarHandle = null;
    }
  }

  function screenShell(children) {
    return h('div', { class: 'screen' }, [
      h('div', { class: 'screen-header' }, [
        h('span', { class: 'screen-header__eyebrow' }, ['This week']),
        h('h1', { class: 'screen-header__title', tabindex: '-1' }, ['Grocery list']),
        h('p', { class: 'screen-header__subtitle' }, [
          'Grouped by aisle, with every amount traced back to the recipe that needs it.',
        ]),
      ]),
      ...children,
    ]);
  }

  function drawLoading() {
    unmountPrimary();
    container.replaceChildren(screenShell([createLoadingState({ label: 'Loading your grocery list…' })]));
  }

  function drawError(err, retry) {
    unmountPrimary();
    const message = err instanceof ApiError ? err.message : 'Could not load your grocery list.';
    container.replaceChildren(
      screenShell([
        createErrorState({
          title: 'Your grocery list did not load',
          message,
          retryLabel: 'Try again',
          onRetry: retry,
        }),
      ]),
    );
  }

  function drawNoPlan() {
    unmountPrimary();
    container.replaceChildren(
      screenShell([
        createEmptyState({
          iconName: 'info',
          title: 'No plan yet',
          message: 'Your grocery list is built from your plan. Set up a plan first and this list fills in on its own.',
        }),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'Go to plan', onClick: () => navigate('/plan') });
  }

  function drawEmptyList() {
    unmountPrimary();
    container.replaceChildren(
      screenShell([
        createEmptyState({
          iconName: 'info',
          title: 'Nothing to buy yet',
          message: "This plan doesn't have any grocery items yet. Once it has meals, they show up here.",
        }),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'View plan', onClick: () => navigate('/plan') });
  }

  // -------------------------------------------------------------------
  // Row building + in-place refresh (so an edit/check updates one row,
  // not the whole scrolled list).
  // -------------------------------------------------------------------

  function applyLineUpdate(updated) {
    lineIndex.set(updated.line_id, updated);
    const old = rowElements.get(updated.line_id);
    if (!old) return;
    const fresh = buildLineRow(updated);
    old.replaceWith(fresh);
    rowElements.set(updated.line_id, fresh);
  }

  async function toggleChecked(line) {
    const previous = line.checked;
    const optimistic = { ...line, checked: !previous };
    applyLineUpdate(optimistic);
    try {
      const { line: updated } = await patchGroceryLine(line.line_id, { checked: optimistic.checked });
      if (destroyed) return;
      applyLineUpdate(updated);
      announce(`${capitalize(updated.display_name)} marked as ${updated.checked ? 'bought' : 'not bought'}.`);
    } catch (err) {
      if (destroyed) return;
      applyLineUpdate({ ...line, checked: previous });
      announce(err instanceof ApiError ? err.message : 'Could not update that item.', { assertive: true });
    }
  }

  async function revertQuantity(lineId, previousValue, displayName) {
    try {
      const { line: updated } = await patchGroceryLine(lineId, { user_edited_quantity: previousValue });
      if (destroyed) return;
      applyLineUpdate(updated);
      announce(`Change to ${capitalize(displayName)} undone.`);
    } catch (err) {
      if (destroyed) return;
      announce(err instanceof ApiError ? err.message : 'Could not undo that change.', { assertive: true });
    }
  }

  function buildLineRow(line) {
    const effective = line.user_edited_quantity || line.purchase_quantity;
    const qtyText = formatQuantity(effective);
    const metaBits = [];
    if (line.package_label) {
      metaBits.push(line.is_estimate ? `${line.package_label} — estimated` : line.package_label);
    } else if (isZero(effective)) {
      metaBits.push('Already have enough');
    }
    if (line.user_edited_quantity) metaBits.push('edited');

    const checkbox = h('input', {
      type: 'checkbox',
      class: 'grocery-line__checkbox',
      '.checked': line.checked,
      'aria-label': `Mark ${line.display_name} as bought`,
      onChange: () => toggleChecked(line),
    });

    const openBtn = h(
      'button',
      {
        type: 'button',
        class: 'grocery-line__body',
        'aria-haspopup': 'dialog',
        'aria-label': `Why am I buying ${qtyText} ${line.unit} of ${line.display_name}?`,
        onClick: () => openProvenanceDrawer(line),
      },
      [
        h('span', { class: 'grocery-line__text' }, [
          h('span', { class: 'grocery-line__name' }, [capitalize(line.display_name)]),
          metaBits.length ? h('span', { class: 'grocery-line__meta' }, [metaBits.join(' · ')]) : null,
        ]),
        h('span', { class: 'grocery-line__qty num' }, [`${qtyText} ${line.unit}`]),
        icon('chevronLeft'),
      ],
    );

    const row = h(
      'li',
      { class: 'grocery-line', dataset: { checked: String(line.checked) } },
      [h('label', { class: 'grocery-line__check' }, [checkbox]), openBtn],
    );
    return row;
  }

  function mountLineRow(line) {
    lineIndex.set(line.line_id, line);
    const el = buildLineRow(line);
    rowElements.set(line.line_id, el);
    return el;
  }

  // -------------------------------------------------------------------
  // Provenance drawer — names EVERY contributing recipe + amount, shows
  // inventory deduction and expected surplus, and hosts the quantity
  // editor (protected user edits, undo instead of a confirm dialog).
  // -------------------------------------------------------------------

  function openProvenanceDrawer(line) {
    const current = lineIndex.get(line.line_id) || line;
    const errorHost = h('div', {});

    const contributionsList = h(
      'ul',
      { class: 'grocery-drawer__list' },
      current.provenance.contributions.map((c) =>
        h('li', { class: 'grocery-drawer__contribution' }, [
          h('span', { class: 'grocery-drawer__contribution-name' }, [c.recipe_name]),
          h('span', { class: 'grocery-drawer__contribution-amount num' }, [`${formatQuantity(c.amount)} ${c.unit}`]),
        ]),
      ),
    );

    const deducted = current.provenance.inventory_deducted;
    const surplus = current.provenance.expected_surplus;
    const statLines = [];
    if (!isZero(deducted)) {
      statLines.push(
        h('p', { class: 'grocery-drawer__stat' }, [
          'Already had on hand: ',
          h('span', { class: 'num' }, [`${formatQuantity(deducted)} ${current.unit}`]),
          ' — deducted from what you need to buy.',
        ]),
      );
    }
    if (!isZero(surplus)) {
      statLines.push(
        h('p', { class: 'grocery-drawer__stat' }, [
          'Expected surplus after this shop: ',
          h('span', { class: 'num' }, [`${formatQuantity(surplus)} ${current.unit}`]),
          current.is_estimate ? ' (estimated, from package size).' : '.',
        ]),
      );
    }
    if (statLines.length === 0) {
      statLines.push(
        h('p', { class: 'grocery-drawer__stat text-muted' }, [
          'Nothing on hand was counted toward this — the full amount is new.',
        ]),
      );
    }

    const effective = current.user_edited_quantity || current.purchase_quantity;
    /** @type {HTMLInputElement} */
    const input = /** @type {HTMLInputElement} */ (
      h('input', {
        class: 'input',
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        '.value': formatQuantity(effective),
        'aria-label': `Amount of ${current.display_name} to buy, in ${current.unit}`,
      })
    );

    /** @type {HTMLButtonElement} */
    const saveBtn = /** @type {HTMLButtonElement} */ (h(
      'button',
      {
        type: 'button',
        class: 'btn btn--secondary',
        onClick: async () => {
          errorHost.replaceChildren();
          let parsed;
          try {
            parsed = buildQuantity(input.value);
          } catch (err) {
            errorHost.replaceChildren(
              h('p', { class: 'grocery-drawer__error', role: 'alert' }, [
                err instanceof ApiError ? err.message : 'Enter a number, fraction, or mixed number.',
              ]),
            );
            return;
          }
          saveBtn.disabled = true;
          const previous = current.user_edited_quantity;
          try {
            const { line: updated } = await patchGroceryLine(current.line_id, { user_edited_quantity: parsed });
            if (destroyed) return;
            applyLineUpdate(updated);
            closeSheet();
            snackbarHandle = showUndoSnackbar({
              message: `Set ${capitalize(current.display_name)} to ${formatQuantity(parsed)} ${current.unit}.`,
              onUndo: () => revertQuantity(current.line_id, previous, current.display_name),
            });
          } catch (err) {
            if (destroyed) return;
            saveBtn.disabled = false;
            errorHost.replaceChildren(
              h('p', { class: 'grocery-drawer__error', role: 'alert' }, [
                err instanceof ApiError ? err.message : 'Could not save that amount.',
              ]),
            );
          }
        },
      },
      ['Save amount'],
    ));

    const resetBtn = current.user_edited_quantity
      ? h(
          'button',
          {
            type: 'button',
            class: 'back-link',
            onClick: async () => {
              const previous = current.user_edited_quantity;
              try {
                const { line: updated } = await patchGroceryLine(current.line_id, { user_edited_quantity: null });
                if (destroyed) return;
                applyLineUpdate(updated);
                closeSheet();
                snackbarHandle = showUndoSnackbar({
                  message: `Reset ${capitalize(current.display_name)} to the suggested amount.`,
                  onUndo: () => revertQuantity(current.line_id, previous, current.display_name),
                });
              } catch (err) {
                if (destroyed) return;
                errorHost.replaceChildren(
                  h('p', { class: 'grocery-drawer__error', role: 'alert' }, [
                    err instanceof ApiError ? err.message : 'Could not reset that amount.',
                  ]),
                );
              }
            },
          },
          [`Reset to suggested (${formatQuantity(current.purchase_quantity)} ${current.unit})`],
        )
      : null;

    const content = h('div', { class: 'grocery-drawer' }, [
      current.package_label
        ? h('p', { class: 'grocery-drawer__package text-secondary' }, [
            current.package_label,
            current.is_estimate ? ' — estimated' : '',
          ])
        : null,
      h('h3', { class: 'grocery-drawer__heading' }, ['Why am I buying this?']),
      contributionsList,
      ...statLines,
      h('div', { class: 'grocery-drawer__edit' }, [
        h('span', { class: 'field__label' }, ['Amount to buy']),
        h('div', { class: 'grocery-drawer__input-row' }, [input, h('span', { class: 'grocery-drawer__unit' }, [current.unit])]),
        errorHost,
        h('div', { class: 'grocery-drawer__actions' }, [saveBtn, resetBtn]),
      ]),
    ]);

    currentSheet = openSheet({
      title: capitalize(current.display_name),
      content,
      onClose: () => {
        currentSheet = null;
      },
    });
  }

  function openToTasteDrawer(item) {
    const content = h('div', { class: 'grocery-drawer' }, [
      h('h3', { class: 'grocery-drawer__heading' }, ['Why is this on my list?']),
      h('p', { class: 'grocery-drawer__stat text-secondary' }, [
        'Used to taste — no measured amount, added as needed while cooking.',
      ]),
      h(
        'ul',
        { class: 'grocery-drawer__list' },
        item.recipe_names.map((name) =>
          h('li', { class: 'grocery-drawer__contribution' }, [
            h('span', { class: 'grocery-drawer__contribution-name' }, [name]),
          ]),
        ),
      ),
    ]);
    currentSheet = openSheet({
      title: capitalize(item.display_name),
      content,
      onClose: () => {
        currentSheet = null;
      },
    });
  }

  // -------------------------------------------------------------------
  // Happy-path assembly
  // -------------------------------------------------------------------

  function confirmationBlock(questions) {
    if (!questions.length) return null;
    return h('div', { class: 'grocery-questions' }, [
      h('div', { class: 'grocery-questions__header' }, [
        icon('info'),
        h('span', { class: 'grocery-questions__title' }, ['Worth double-checking']),
      ]),
      h(
        'ul',
        { class: 'grocery-questions__list' },
        questions.map((q) => h('li', { class: 'grocery-questions__item' }, [q.question])),
      ),
    ]);
  }

  function toTasteBlock(items) {
    if (!items.length) return null;
    return h('section', { class: 'grocery-section' }, [
      h('h2', { class: 'grocery-section__title' }, ['To taste']),
      h(
        'ul',
        { class: 'grocery-section__list' },
        items.map((item) =>
          h('li', { class: 'grocery-line grocery-line--totaste' }, [
            h(
              'button',
              {
                type: 'button',
                class: 'grocery-line__body',
                'aria-haspopup': 'dialog',
                'aria-label': `Why is ${item.display_name} on my list?`,
                onClick: () => openToTasteDrawer(item),
              },
              [
                h('span', { class: 'grocery-line__text' }, [
                  h('span', { class: 'grocery-line__name' }, [capitalize(item.display_name)]),
                  h('span', { class: 'grocery-line__meta' }, [`For ${item.recipe_names.join(', ')}`]),
                ]),
                h('span', { class: 'grocery-line__qty text-muted' }, ['To taste']),
                icon('chevronLeft'),
              ],
            ),
          ]),
        ),
      ),
    ]);
  }

  function sectionBlock(section) {
    return h('section', { class: 'grocery-section' }, [
      h('h2', { class: 'grocery-section__title' }, [sectionLabel(section.section)]),
      h('ul', { class: 'grocery-section__list' }, section.lines.map((line) => mountLineRow(line))),
    ]);
  }

  /** @param {GroceryListView} list */
  function drawList(list) {
    unmountPrimary();
    lineIndex.clear();
    rowElements.clear();
    const children = [
      confirmationBlock(list.confirmation_questions),
      toTasteBlock(list.to_taste),
      ...list.sections.map((s) => sectionBlock(s)),
    ].filter(Boolean);
    container.replaceChildren(screenShell(children));
  }

  async function load() {
    drawLoading();
    try {
      const { plan } = await getCurrentPlan();
      if (destroyed) return;
      planId = plan.plan_id;
    } catch (err) {
      if (destroyed) return;
      if (err instanceof ApiError && err.code === 'no_current_plan') {
        drawNoPlan();
      } else {
        drawError(err, load);
      }
      return;
    }

    try {
      const { list } = await getGroceryList(planId);
      if (destroyed) return;
      const hasLines = list.sections.length > 0 || list.to_taste.length > 0;
      if (!hasLines) {
        drawEmptyList();
      } else {
        drawList(list);
      }
    } catch (err) {
      if (destroyed) return;
      drawError(err, load);
    }
  }

  load();

  return () => {
    destroyed = true;
    unmountPrimary();
    closeSheet();
    dismissSnackbar();
  };
}
