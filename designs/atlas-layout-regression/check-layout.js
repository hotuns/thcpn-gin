// Read-only browser regression probe. Run against the opened technology view
// through CUA Playwright.evaluate; no authentication or business data is read.
(() => {
  const host = document.querySelector('.atlas-analysis-host');
  if (!host) throw new Error('Open a technology Atlas view with selected trends');
  const box = element => element.getBoundingClientRect();
  const fits = (child, parent) => {
    const c = box(child), p = box(parent);
    return c.top >= p.top - 1 && c.bottom <= p.bottom + 1;
  };
  const content = host.querySelector('.atlas-analysis');
  const trends = host.querySelector('.atlas-trends');
  const cards = [...host.querySelectorAll('.atlas-trend')];
  const checks = {
    contentInsideFrame: !!content && fits(content, host),
    gridInsideContent: !!trends && fits(trends, content),
    cardsInsideGrid: cards.length > 2 || cards.every(card => fits(card, trends)),
    frameDoesNotScroll: getComputedStyle(host).overflow === 'hidden',
    chartHasArea: [...host.querySelectorAll('.atlas-chart')].every(chart => box(chart).height >= 90),
  };
  if (Object.values(checks).some(pass => !pass)) throw new Error(JSON.stringify(checks));
  return { checks, frameHeight: box(host).height, cards: cards.length };
})()
