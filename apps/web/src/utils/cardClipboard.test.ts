import { describe, it, expect, beforeEach } from 'vitest';
import { cardClipboard, type ClipboardCard } from './cardClipboard';

const makeCard = (): ClipboardCard => ({
  title: '发布 MVP',
  level: 2,
  weekStartDate: '2026-03-02',
  summary: '概述',
  notes: '细节'
});

describe('card clipboard', () => {
  beforeEach(() => cardClipboard.clear());

  it('starts empty', () => {
    expect(cardClipboard.size).toBe(0);
    expect(cardClipboard.read()).toEqual([]);
  });

  it('round-trips a copied card', () => {
    const card = makeCard();
    expect(cardClipboard.write([card])).toBe(1);
    expect(cardClipboard.read()).toEqual([card]);
  });

  it('copies a snapshot, so later edits to the source do not leak in', () => {
    const card = makeCard();
    cardClipboard.write([card]);
    card.title = '被改掉的标题';
    expect(cardClipboard.read()[0].title).toBe('发布 MVP');
  });

  it('replaces the previous clipboard on each copy', () => {
    cardClipboard.write([makeCard(), makeCard()]);
    expect(cardClipboard.size).toBe(2);
    cardClipboard.write([makeCard()]);
    expect(cardClipboard.size).toBe(1);
  });

  it('hands out copies so a paste cannot mutate the stored card', () => {
    cardClipboard.write([makeCard()]);
    const first = cardClipboard.read();
    first[0].title = '粘贴时被改';
    expect(cardClipboard.read()[0].title).toBe('发布 MVP');
  });
});
