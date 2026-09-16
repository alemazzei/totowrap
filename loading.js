(() => {
  const phrases = ["Complimenti Colette per la vittoria del TotoWrap"];
  const screen = document.getElementById("loadingScreen");
  const quote = document.getElementById("loadingQuote");
  let index = 0;
  // Con una sola frase non lampeggia; aggiungendo frasi, cambia ogni secondo.
  const timer = setInterval(() => {
    if (screen.hidden) return;
    index = (index + 1) % phrases.length;
    if (quote.textContent !== phrases[index]) quote.textContent = phrases[index];
  }, 1000);
  const observer = new MutationObserver(() => {
    if (screen.hidden) { clearInterval(timer); observer.disconnect(); }
  });
  observer.observe(screen, { attributes: true, attributeFilter: ["hidden"] });
})();
