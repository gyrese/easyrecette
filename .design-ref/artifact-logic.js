data-dc-script="" data-props="{&quot;$preview&quot;:{&quot;width&quot;:1320,&quot;height&quot;:920},&quot;defaultServings&quot;:{&quot;editor&quot;:&quot;int&quot;,&quot;default&quot;:4,&quot;min&quot;:1,&quot;max&quot;:12,&quot;tsType&quot;:&quot;number&quot;,&quot;section&quot;:&quot;Studio&quot;},&quot;cookModeTheme&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;Sombre&quot;,&quot;Crème&quot;],&quot;default&quot;:&quot;Sombre&quot;,&quot;tsType&quot;:&quot;string&quot;,&quot;section&quot;:&quot;Mode cuisine&quot;},&quot;showHud&quot;:{&quot;editor&quot;:&quot;boolean&quot;,&quot;default&quot;:true,&quot;tsType&quot;:&quot;boolean&quot;,&quot;section&quot;:&quot;Accueil&quot;},&quot;motion&quot;:{&quot;editor&quot;:&quot;enum&quot;,&quot;options&quot;:[&quot;Ample&quot;,&quot;Réduit&quot;],&quot;default&quot;:&quot;Ample&quot;,&quot;tsType&quot;:&quot;string&quot;,&quot;section&quot;:&quot;Animation&quot;}}">
class Component extends DCLogic {
  state = { screen: "accueil", servings: 4, checked: {}, filter: "Tout", phase: 0, url: "", cookStep: 0, remaining: 180, running: false, sound: true, activeTimer: null };

  DATA = [
    { name: "Gnocchi", items: [
      { k: "ricotta", n: "Ricotta égouttée", q: 500, u: "g" },
      { k: "parm1", n: "Parmesan râpé", q: 80, u: "g" },
      { k: "farine", n: "Farine T55", q: 120, u: "g" },
      { k: "jaunes", n: "Jaunes d’œufs", q: 2, u: "" },
      { k: "muscade", n: "Muscade râpée", q: 1, u: "pincée" }
    ]},
    { name: "Beurre de sauge", items: [
      { k: "beurre", n: "Beurre doux", q: 90, u: "g" },
      { k: "sauge", n: "Feuilles de sauge", q: 16, u: "" },
      { k: "ail", n: "Gousse d’ail écrasée", q: 1, u: "" },
      { k: "citron", n: "Jus de citron", q: 1, u: "c. à s." }
    ]},
    { name: "Finition", items: [
      { k: "noisettes", n: "Noisettes torréfiées", q: 40, u: "g" },
      { k: "poivre", n: "Poivre de Sichuan", q: 2, u: "pincées" },
      { k: "parm2", n: "Copeaux de parmesan", q: 30, u: "g" }
    ]}
  ];

  STEPS = [
    { t: "Égouttez la ricotta 30 minutes dans une passoire tapissée de mousseline. Une pâte trop humide demandera trop de farine." },
    { t: "Mélangez ricotta, parmesan, jaunes et muscade jusqu’à obtenir une masse lisse, sans travailler l’appareil." },
    { t: "Incorporez la farine en trois fois. La pâte doit rester souple et à peine collante sous le doigt." },
    { t: "Formez des boudins de 2 cm, détaillez des tronçons réguliers et farinez-les légèrement.", tip: "Roulez-les sur le dos d’une fourchette pour créer les stries qui retiendront le beurre." },
    { t: "Pochez les gnocchi dans une eau frémissante salée. Ils sont prêts dès qu’ils remontent à la surface.", d: 180, label: "Pocher 3 min" },
    { t: "Faites fondre le beurre à feu moyen jusqu’à coloration noisette, puis ajoutez la sauge et l’ail.", d: 240, label: "Beurre noisette 4 min", tip: "Arrêtez la cuisson dès que l’odeur devient de noisette : trente secondes de plus et le beurre brûle." },
    { t: "Roulez les gnocchi égouttés dans le beurre, dressez avec les noisettes concassées, le parmesan et le poivre." }
  ];

  get reduced() { return (this.props.motion || "Ample") === "Réduit"; }

  reveal = el => {
    if (!el) return;
    const kids = el.dataset.stagger ? Array.from(el.children) : [el];
    kids.forEach((k, i) => {
      k.style.opacity = "";
      if (this.reduced) { k.style.animation = ""; return; }
      k.style.animation = "er-in .7s cubic-bezier(.16,1,.3,1) " + (i * 70) + "ms both";
    });
  };

  fiche = el => {
    if (!el || el.__fc) return;
    el.__fc = 1;
    const rot = el.dataset.rot || "0";
    if (this.reduced) return;
    el.addEventListener("pointerenter", () => { el.style.transform = "rotate(0deg) translateY(-8px)"; });
    el.addEventListener("pointerleave", () => { el.style.transform = "rotate(" + rot + "deg)"; });
  };

  tilt = el => {
    if (!el || el.__tl) return;
    el.__tl = 1;
    if (this.reduced) return;
    el.addEventListener("pointermove", e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      el.style.transform = "perspective(1600px) rotateX(" + (-y * 3.6) + "deg) rotateY(" + (x * 4.4) + "deg) translateY(-5px)";
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  };

  glow = el => {
    if (!el || el.__gl) return;
    el.__gl = 1;
    el.addEventListener("pointermove", e => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
      el.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
    });
  };

  componentDidMount() {
    if (this.props.defaultServings) this.setState({ servings: this.props.defaultServings });
    this._t = setInterval(() => {
      if (this.state.running && this.state.remaining > 0) this.setState(s => ({ remaining: s.remaining - 1, running: s.remaining - 1 > 0 }));
    }, 1000);
  }
  componentWillUnmount() { clearInterval(this._t); [this._a, this._b, this._c].forEach(clearTimeout); }

  go(s) { return () => this.setState({ screen: s }); }
  fmtQ(q) {
    const v = q * (this.state.servings / 4);
    const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    return String(r).replace(".", ",");
  }
  clock(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  startImport = () => {
    this.setState({ phase: 1, url: this.state.url || "tiktok.com/@chef_artisan/video/7412…" });
    this._a = setTimeout(() => this.setState({ phase: 2 }), 900);
    this._b = setTimeout(() => this.setState({ phase: 3 }), 1900);
    this._c = setTimeout(() => this.setState({ phase: 4 }), 2900);
  };

  pill(active) {
    return "padding:9px 14px;border:1.5px solid " + (active ? "#17140F" : "rgba(23,20,15,.3)") +
      ";border-radius:2px;background:" + (active ? "#17140F" : "transparent") +
      ";color:" + (active ? "#F2EDE3" : "rgba(23,20,15,.6)") +
      ";font:500 10px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:.2s";
  }
  navPill(active) {
    return "padding:10px 15px;border:none;border-right:1.5px solid #17140F;background:" + (active ? "#17140F" : "transparent") +
      ";color:" + (active ? "#F2EDE3" : "rgba(23,20,15,.62)") +
      ";font:500 10px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:.2s";
  }
  hudPill(i) {
    const p = this.state.phase, done = p > i, live = p === i;
    const col = done ? "#D8F250" : live ? "#F2EDE3" : "rgba(242,237,227,.35)";
    return "display:flex;align-items:center;gap:10px;font:400 11px 'DM Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:" + col + ";transition:.4s";
  }
  hudDot(i) {
    const p = this.state.phase;
    return "width:7px;height:7px;flex:none;background:" + (p > i ? "#D8F250" : p === i ? "#D6461F" : "rgba(242,237,227,.22)") + (p === i ? ";animation:er-blink 1s steps(1) infinite" : "");
  }

  renderVals() {
    const st = this.state;
    const dark = (this.props.cookModeTheme || "Sombre") === "Sombre";
    const bg = dark ? "#17140F" : "#F2EDE3";
    const ink = dark ? "#F2EDE3" : "#17140F";
    const soft = dark ? "rgba(242,237,227,.5)" : "rgba(23,20,15,.5)";
    const rule = dark ? "rgba(242,237,227,.22)" : "rgba(23,20,15,.22)";
    const circ = 2 * Math.PI * 132;
    const step = this.STEPS[st.cookStep];
    const total = st.activeTimer || 180;
    const nChecked = Object.values(st.checked).filter(Boolean).length;

    const groups = this.DATA.map(g => ({
      name: g.name,
      items: g.items.map(it => {
        const on = !!st.checked[it.k];
        return {
          name: it.n,
          qty: this.fmtQ(it.q) + (it.u ? " " + it.u : ""),
          mark: on ? "✕" : "",
          toggle: () => this.setState(s => ({ checked: Object.assign({}, s.checked, { [it.k]: !s.checked[it.k] }) })),
          dot: "flex:none;width:17px;height:17px;display:flex;align-items:center;justify-content:center;font:500 10px 'DM Mono',monospace;border:1.5px solid " + (on ? "#D6461F" : "rgba(23,20,15,.32)") + ";color:#D6461F;background:" + (on ? "rgba(214,70,31,.12)" : "transparent") + ";transition:.2s" + (on ? ";animation:er-pop .34s cubic-bezier(.16,1,.3,1)" : ""),
          label: "flex:1;min-width:0;font:300 14.5px 'Bricolage Grotesque',sans-serif;color:" + (on ? "rgba(23,20,15,.36)" : "rgba(23,20,15,.9)") + ";text-decoration:" + (on ? "line-through" : "none") + ";transition:.2s",
          qtyStyle: "flex:none;font:500 12px 'DM Mono',monospace;letter-spacing:.04em;color:" + (on ? "rgba(23,20,15,.3)" : "#17140F") + ";transition:.2s"
        };
      })
    }));

    const steps = this.STEPS.map((s, i) => {
      const live = st.activeTimer && st.running && st.cookStep === i && st.screen === "studio";
      return {
        n: String(i + 1).padStart(2, "0"), text: s.t, hasTimer: !!s.d, hasTip: !!s.tip, tip: s.tip || "",
        chipLabel: live ? this.clock(st.remaining) + " restantes" : (s.label || "") + " ▶",
        chipStyle: "margin-top:14px;padding:10px 15px;border:1.5px solid " + (live ? "#D6461F" : "#17140F") + ";border-radius:2px;background:" + (live ? "#D6461F" : "transparent") + ";color:" + (live ? "#F7F2E8" : "#17140F") + ";font:500 10px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:.2s",
        startTimer: () => this.setState({ activeTimer: s.d, remaining: s.d, running: true, cookStep: i })
      };
    });

    return {
      reveal: this.reveal, tilt: this.tilt, glow: this.glow, fiche: this.fiche,
      isHome: st.screen === "accueil", isLib: st.screen === "bibliotheque", isStudio: st.screen === "studio",
      isGrocery: st.screen === "epicerie", isCook: st.screen === "cuisine",
      goHome: this.go("accueil"), goLib: this.go("bibliotheque"), goStudio: this.go("studio"),
      goGrocery: this.go("epicerie"), goCook: this.go("cuisine"),
      navHome: this.navPill(st.screen === "accueil"), navLib: this.navPill(st.screen === "bibliotheque"),
      navStudio: this.navPill(st.screen === "studio" || st.screen === "cuisine"), navGrocery: this.navPill(st.screen === "epicerie"),

      url: st.url, setUrl: e => this.setState({ url: e.target.value }),
      pasteDemo: () => this.setState({ url: "tiktok.com/@chef_artisan/video/7412…" }),
      startImport: this.startImport,
      showHud: this.props.showHud !== false,
      importDone: st.phase >= 4,
      hudStatus: st.phase === 0 ? "prêt" : st.phase >= 4 ? "terminé" : "analyse…",
      hud1: this.hudPill(1), hud2: this.hudPill(2), hud3: this.hudPill(3),
      hudDot1: this.hudDot(1), hudDot2: this.hudDot(2), hudDot3: this.hudDot(3),
      hudBar: "height:100%;width:" + Math.min(100, st.phase * 25) + "%;background:#D8F250;transition:width .7s cubic-bezier(.16,1,.3,1)",
      scanline: "position:absolute;left:0;right:0;top:0;height:22%;background:linear-gradient(to bottom,transparent,rgba(216,242,80,.16),transparent);pointer-events:none;opacity:" + (st.phase > 0 && st.phase < 4 ? 1 : 0) + ";animation:er-scan 1.7s linear infinite;transition:opacity .4s",

      fTous: this.pill(st.filter === "Tout"), fQuick: this.pill(st.filter === "Rapides"), fProt: this.pill(st.filter === "Protéines"),
      fDess: this.pill(st.filter === "Desserts"), fBake: this.pill(st.filter === "Boulange"), fVeg: this.pill(st.filter === "Végétarien"),
      setFilterAll: () => this.setState({ filter: "Tout" }), setFilterQuick: () => this.setState({ filter: "Rapides" }),
      setFilterProt: () => this.setState({ filter: "Protéines" }), setFilterDess: () => this.setState({ filter: "Desserts" }),
      setFilterBake: () => this.setState({ filter: "Boulange" }), setFilterVeg: () => this.setState({ filter: "Végétarien" }),

      servings: st.servings, kcal: 486,
      inc: () => this.setState(s => ({ servings: Math.min(12, s.servings + 1) })),
      dec: () => this.setState(s => ({ servings: Math.max(1, s.servings - 1) })),
      groups, steps, checkedCount: nChecked,
      checkBar: "height:100%;width:" + (nChecked / 12 * 100) + "%;background:#D6461F;transition:width .45s cubic-bezier(.16,1,.3,1)",

      circ: circ, dash: circ * (1 - st.remaining / total),
      clock: this.clock(st.remaining), timerCaption: st.running ? "en cours" : "en pause",
      cookN: String(st.cookStep + 1).padStart(2, "0"), cookNum: String(st.cookStep + 1).padStart(2, "0"), cookStepText: step.t,
      prevStep: () => this.setState(s => ({ cookStep: Math.max(0, s.cookStep - 1) })),
      nextStep: () => this.setState(s => ({ cookStep: Math.min(6, s.cookStep + 1) })),
      toggleRun: () => this.setState(s => ({ running: !s.running, remaining: s.remaining || total })),
      runLabel: st.running ? "Pause ▮▮" : "Démarrer ▶",
      toggleSound: () => this.setState(s => ({ sound: !s.sound })),
      soundLabel: st.sound ? "Son ▮▮▮" : "Son ✕",

      cookShell: "position:fixed;inset:0;z-index:100;background:" + bg + ";color:" + ink + ";padding:40px 34px;display:flex;align-items:center;overflow-y:auto;overflow-x:hidden",
      cookAmbient: "position:absolute;top:-28%;right:-18%;width:64vw;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,rgba(214,70,31,.2),transparent 66%);filter:blur(20px);animation:er-drift 20s ease-in-out infinite;pointer-events:none",
      cookRule: rule,
      cookMeta: "font:500 10.5px 'DM Mono',monospace;letter-spacing:.2em;text-transform:uppercase;color:" + soft,
      cookIndex: "font-family:'Instrument Serif',serif;font-size:clamp(70px,10vw,130px);line-height:.8;letter-spacing:-.05em;color:" + (dark ? "rgba(242,237,227,.18)" : "rgba(23,20,15,.16)"),
      cookText: "margin:18px 0 0;font-family:'Instrument Serif',serif;font-weight:400;font-size:clamp(30px,4.4vw,56px);line-height:1.08;letter-spacing:-.032em;color:" + ink + ";text-wrap:pretty",
      timerText: "font-family:'Instrument Serif',serif;font-size:72px;line-height:1;letter-spacing:-.03em;color:" + ink,
      runBtn: "padding:15px 34px;border:1.5px solid " + (st.running ? rule : "#D6461F") + ";border-radius:2px;background:" + (st.running ? "transparent" : "#D6461F") + ";color:" + (st.running ? ink : "#F7F2E8") + ";font:500 11px 'DM Mono',monospace;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;min-width:180px;transition:.22s",
      soundBtn: "padding:10px 15px;border:1.5px solid " + rule + ";border-radius:2px;background:transparent;color:" + soft + ";font:500 10px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:.22s",
      closeBtn: "padding:10px 15px;border:1.5px solid " + ink + ";border-radius:2px;background:" + ink + ";color:" + bg + ";font:500 10px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:.22s",
      navBtn: "flex:1;max-width:300px;padding:22px;border:1.5px solid " + rule + ";border-radius:2px;background:transparent;color:" + ink + ";font:500 12px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:.22s",
      nextBtn: "flex:1;max-width:300px;padding:22px;border:1.5px solid #D8F250;border-radius:2px;background:#D8F250;color:#17140F;font:500 12px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:.22s"
    };
  }
}
</script>


<div id="__claude_design_branding"><style>#__claude_design_branding{position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;align-items:center;gap:7px;height:30px;padding:0 5px 0 10px;border-radius:999px;font-family:"Anthropic Sans",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;font-size:12.5px;font-weight:400;line-height:1;letter-spacing:normal;text-transform:none;color:#141413;background:rgba(255,255,255,.86);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);box-shadow:0 0 0 .5px rgba(31,30,29,.14),0 2px 10px rgba(0,0,0,.09)}
#__claude_design_branding *{box-sizing:border-box;margin:0}
#__claude_design_branding a{color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
#__claude_design_branding a:hover span{text-decoration:underline}
#__claude_design_branding svg{flex:none}
#__claude_design_branding a svg{color:#D97757}
#__claude_design_branding button{width:20px;height:20px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:currentColor;opacity:.55;border:0;background:none;cursor:pointer;flex:none;font:inherit;transition:opacity .14s}
#__claude_design_branding button:hover{opacity:1;background:rgba(127,127,127,.22)}
@media print{#__claude_design_branding{display:none}}</style><a href="https://claude.com/product/design" target="_blank" rel="noopener noreferrer"><svg width="14" height="14" viewBox="0 0 20 21" fill="none" aria-hidden="true"><path fill="currentColor" d="M9.99902 0C15.5258 0.000170936 19.999 4.50643 19.999 10.0547C19.999 11.7656 19.5863 12.9976 18.7861 13.8203C17.9924 14.6362 16.9465 14.9138 15.9854 15.0078C15.05 15.0993 14.0097 15.0262 13.2549 15.0186C12.8524 15.0145 12.5177 15.0267 12.2441 15.0703C11.9682 15.1144 11.8143 15.1813 11.7305 15.2432C11.4745 15.4322 11.3353 15.7121 11.2656 16.1602C11.2303 16.3875 11.2168 16.6362 11.209 16.9131C11.2017 17.1715 11.1986 17.4893 11.1807 17.7705C11.1469 18.2975 11.0495 19.0865 10.4199 19.5908C9.7846 20.0996 8.88652 20.1057 7.85449 19.877C7.36399 19.7682 6.88652 19.6232 6.42578 19.4453C2.66989 17.9949 0.000187748 14.3414 0 10.0547C0 4.50643 4.47223 0.000171048 9.99902 0ZM9.99902 1.60547C5.36781 1.60564 1.60547 5.38391 1.60547 10.0547C1.60566 13.6582 3.84823 16.7296 7.00391 17.9482C7.39027 18.0974 7.79085 18.2184 8.20215 18.3096C9.1375 18.5169 9.384 18.3633 9.41602 18.3379C9.4524 18.3087 9.54558 18.1915 9.5791 17.668C9.5947 17.4239 9.59473 17.1786 9.60352 16.8672C9.61179 16.5742 9.62831 16.2435 9.67969 15.9131C9.78359 15.2455 10.0474 14.4906 10.7764 13.9521C11.1479 13.6778 11.5842 13.5493 11.9912 13.4844C12.4007 13.4191 12.8434 13.4088 13.2705 13.4131C14.1753 13.4222 15.0071 13.4905 15.8291 13.4102C16.6257 13.3322 17.2249 13.1235 17.6357 12.7012C18.0401 12.2855 18.3935 11.5261 18.3936 10.0547C18.3936 5.38391 14.6302 1.60564 9.99902 1.60547ZM5.11621 9.86719C5.86386 9.91468 6.45486 10.5348 6.45508 11.2939C6.45506 12.0838 5.81519 12.7245 5.02539 12.7246C4.28481 12.7246 3.67573 12.1617 3.60254 11.4404L3.59473 11.2939L3.60156 11.1533C3.66942 10.4596 4.23282 9.91186 4.93359 9.86719H5.11621ZM14.9814 7.19141C15.729 7.23889 16.3199 7.85919 16.3203 8.61816C16.3203 9.40801 15.6804 10.0487 14.8906 10.0488C14.1501 10.0487 13.5409 9.48586 13.4678 8.76465L13.46 8.61816L13.4668 8.47754C13.5348 7.78403 14.0983 7.23618 14.7988 7.19141H14.9814ZM6.4541 4.93457C7.20161 4.9822 7.79275 5.60231 7.79297 6.36133C7.79288 7.151 7.15291 7.7917 6.36328 7.79199C5.62274 7.79199 5.01369 7.22903 4.94043 6.50781L4.93262 6.36133L4.93945 6.2207C5.00731 5.52698 5.5707 4.97922 6.27148 4.93457H6.4541ZM11.3867 3.59668C12.1343 3.64419 12.7253 4.26436 12.7256 5.02344C12.7256 5.81326 12.0857 6.45393 11.2959 6.4541C10.5553 6.4541 9.94622 5.89123 9.87305 5.16992L9.86523 5.02344L9.87207 4.88281C9.93996 4.18912 10.5033 3.64133 11.2041 3.59668H11.3867Z"></path></svg><span>Made with Claude Design</span></a><button type="button" aria-label="Dismiss" onclick="this.parentElement.remove()"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg></button></div></body></html>