import { describe, it, expect } from 'vitest';
import { planCollapseToggle, pruneCollapsedIds } from './cardCollapse';

describe('planCollapseToggle', () => {
  it('folds an expanded card', () => {
    const plan = planCollapseToggle(new Set(), ['a']);
    expect(plan.willCollapse).toBe(true);
    expect(Array.from(plan.next)).toEqual(['a']);
  });

  it('expands a card that is already folded', () => {
    const plan = planCollapseToggle(new Set(['a']), ['a']);
    expect(plan.willCollapse).toBe(false);
    expect(plan.next.size).toBe(0);
  });

  it('is idempotent per press: fold, expand, fold', () => {
    let state = new Set<string>();
    state = planCollapseToggle(state, ['a']).next;
    expect(Array.from(state)).toEqual(['a']);
    state = planCollapseToggle(state, ['a']).next;
    expect(state.size).toBe(0);
    state = planCollapseToggle(state, ['a']).next;
    expect(Array.from(state)).toEqual(['a']);
  });

  it('folds a mixed multi-selection rather than expanding it', () => {
    const plan = planCollapseToggle(new Set(['a']), ['a', 'b']);
    expect(plan.willCollapse).toBe(true);
    expect(Array.from(plan.next).sort()).toEqual(['a', 'b']);
  });

  it('expands a fully collapsed multi-selection', () => {
    const plan = planCollapseToggle(new Set(['a', 'b']), ['a', 'b']);
    expect(plan.willCollapse).toBe(false);
    expect(plan.next.size).toBe(0);
  });

  it('leaves unselected cards untouched', () => {
    const plan = planCollapseToggle(new Set(['z']), ['a']);
    expect(Array.from(plan.next).sort()).toEqual(['a', 'z']);
  });

  it('does nothing for an empty selection and keeps the same reference', () => {
    const current = new Set(['a']);
    const plan = planCollapseToggle(current, []);
    expect(plan.willCollapse).toBe(false);
    expect(plan.next).toBe(current);
  });

  it('never mutates the input set', () => {
    const current = new Set(['a']);
    planCollapseToggle(current, ['a', 'b']);
    expect(Array.from(current)).toEqual(['a']);
  });
});

describe('pruneCollapsedIds', () => {
  it('drops ids whose card is gone', () => {
    expect(Array.from(pruneCollapsedIds(new Set(['a', 'gone']), new Set(['a'])))).toEqual(['a']);
  });

  it('keeps every id when nothing changed', () => {
    const current = new Set(['a', 'b']);
    expect(pruneCollapsedIds(current, new Set(['a', 'b', 'c']))).toBe(current);
  });

  it('handles an empty collapse set', () => {
    const current = new Set<string>();
    expect(pruneCollapsedIds(current, new Set(['a'])).size).toBe(0);
  });
});
