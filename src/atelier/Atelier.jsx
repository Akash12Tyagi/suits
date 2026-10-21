import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "@fontsource/jost/300.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "./atelier.css";
import { BRAND, CHAPTERS, CONTACT, FOOTER, PATTERNS, SWATCHES } from "./content.js";
import { setupScroll, supportsWebGL } from "./scroll.js";

const pad = (n) => String(n).padStart(2, "0");

function Chapter({ chapter, index, active, colour, onColour, pattern, onPattern }) {
  const { side, eyebrow, title, body, spec, swatches, patterns, drag, cta } = chapter;
  return (
    <section
      className={`chapter chapter--${side}${chapter.theme ? ` chapter--${chapter.theme}` : ""}${active ? " is-active" : ""}`}
      data-chapter={index}
      aria-labelledby={`chapter-${chapter.id}`}
    >
      <div className="chapter__sticky">
        <div className="chapter__text">
          <p className="eyebrow">
            {index > 0 && side !== "centre" && <span className="eyebrow__num">{pad(index)}</span>}
            {eyebrow}
          </p>
          {index === 0 ? (
            <h1 id={`chapter-${chapter.id}`} className="headline headline--hero">
              {title.map((line) => (
                <span className="line" key={line}>
                  <span>{line}</span>
                </span>
              ))}
            </h1>
          ) : (
            <h2 id={`chapter-${chapter.id}`} className="headline">
              {title.map((line) => (
                <span className="line" key={line}>
                  <span>{line}</span>
                </span>
              ))}
            </h2>
          )}
          <p className="body">{body}</p>
          {spec && (
            <p className="spec">
              <span className="spec__label">{spec[0]}</span>
              {spec[1]}
            </p>
          )}
          {swatches && (
            <div className="swatches" role="group" aria-label="Choose a cloth colour">
              {SWATCHES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="swatch"
                  aria-pressed={colour === s.id}
                  onClick={() => onColour(s.id)}
                >
                  <span className="swatch__chip" style={{ background: s.hex }} />
                  <span className="swatch__label">{s.label}</span>
                </button>
              ))}
            </div>
          )}
          {patterns && (
            <div className="swatches swatches--patterns" role="group" aria-label="Choose a cloth">
              {PATTERNS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="swatch"
                  aria-pressed={pattern === p.id}
                  onClick={() => onPattern(p.id)}
                >
                  <span className={`swatch__chip swatch__chip--${p.id}`} />
                  <span className="swatch__label">{p.label}</span>
                </button>
              ))}
            </div>
          )}
          {drag && (
            <p className="hint" aria-hidden="true">
              <span className="hint__icon" />
              Drag to turn the figure
            </p>
          )}
          {cta && (
            <a className="cta" href={CONTACT}>
              {cta}
            </a>
          )}
        </div>
        {index === 0 && (
          <div className="scroll-cue" aria-hidden="true">
            <span>Scroll to assemble</span>
            <i />
          </div>
        )}
      </div>
    </section>
  );
}

export default function Atelier() {
  const stageEl = useRef(null);
  const storyEl = useRef(null);
  const stageApi = useRef(null);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [colour, setColour] = useState("midnight");
  const [pattern, setPattern] = useState("plain");
  const [loading, setLoading] = useState({ label: "Opening the atelier", value: 0.05 });

  useEffect(() => {
    document.title = `${BRAND} — Tailoring for the few`;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scroll = setupScroll({ reducedMotion });
    const triggers = [];
    let disposed = false;
    let cleanupStage = () => {};

    document.querySelectorAll(".chapter").forEach((el, i) => {
      triggers.push(
        ScrollTrigger.create({
          trigger: el,
          start: "top 45%",
          end: "bottom 55%",
          onToggle: (self) => self.isActive && setActive(i),
        })
      );
    });

    if (!supportsWebGL()) {
      setFallback(true);
      setReady(true);
    } else {
      // The 3D engine is loaded on demand so the text paints first; the cast's
      // heads and hands are sculpted in workers before the stage is built.
      Promise.all([import("./three/Stage.js"), import("./three/choreography.js")])
        .then(async (mods) => {
          setLoading({ label: "Sculpting the cast", value: 0.1 });
          await mods[0].prepareStage((done, total) =>
            setLoading({ label: "Sculpting the cast", value: 0.1 + 0.6 * (done / total) })
          );
          setLoading({ label: "Cutting the cloth", value: 0.75 });
          // Let the label paint before the synchronous build.
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
          return mods;
        })
        .then(([{ Stage }, { buildChoreography }]) => {
          if (disposed) return;
          let stage;
          try {
            stage = new Stage(stageEl.current, { reducedMotion });
          } catch (err) {
            console.error(err);
            setFallback(true);
            setReady(true);
            return;
          }
          stageApi.current = stage;
          if (import.meta.env.DEV) window.__atelier = stage;
          const tick = () => stage.tick();
          gsap.ticker.add(tick);
          const tl = buildChoreography(stage, storyEl.current, {
            chapters: CHAPTERS.length,
            reducedMotion,
          });
          setLoading({ label: "Lighting the set", value: 0.92 });
          stage.warmUp(tl, CHAPTERS.length);
          ScrollTrigger.update();
          // Stop drawing once the story has scrolled away under the footer.
          const pause = ScrollTrigger.create({
            trigger: storyEl.current,
            start: "top top",
            end: "bottom top",
            onLeave: () => stage.setPaused(true),
            onEnterBack: () => stage.setPaused(false),
          });
          const intro = gsap.to(stage.hero.look, {
            scan: 1,
            duration: reducedMotion ? 0.01 : 2.6,
            delay: 0.25,
            ease: "power2.inOut",
          });
          requestAnimationFrame(() => !disposed && setReady(true));
          document.fonts?.ready.then(() => !disposed && ScrollTrigger.refresh());

          cleanupStage = () => {
            intro.kill();
            pause.kill();
            tl.scrollTrigger?.kill();
            tl.kill();
            gsap.ticker.remove(tick);
            stage.dispose();
            stageApi.current = null;
          };
        }
      );
    }

    return () => {
      disposed = true;
      triggers.forEach((t) => t.kill());
      cleanupStage();
      scroll.destroy();
    };
  }, []);

  // Turning the figure by hand is offered in the silhouette chapter only;
  // the daylight lookbook chapters switch the page chrome to dark ink.
  useEffect(() => {
    stageApi.current?.setDragEnabled(Boolean(CHAPTERS[active]?.drag));
    document.documentElement.classList.toggle("is-light", CHAPTERS[active]?.theme === "light");
  }, [active, ready]);

  const choosePattern = (id) => {
    setPattern(id);
    stageApi.current?.setPattern(id);
  };

  const chooseColour = (id) => {
    setColour(id);
    const stage = stageApi.current;
    if (!stage) return;
    const proxy = { t: 0 };
    gsap.to(proxy, {
      t: 1,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => stage.hero.setColourway(id, proxy.t),
    });
  };

  return (
    <div className={`atelier${ready ? " is-ready" : ""}${fallback ? " is-fallback" : ""}`}>
      <div className="stage" ref={stageEl} />
      <div className="loader" aria-hidden={ready} role="status">
        <span className="loader__mark">{BRAND}</span>
        <span className="loader__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${ready ? 1 : loading.value})` }} />
        </span>
        <span className="loader__label">{fallback ? "" : loading.label}</span>
      </div>

      <header className="masthead">
        <a className="brand" href="#top" aria-label={`${BRAND} home`}>
          <span className="brand__diamond" aria-hidden="true" />
          {BRAND}
        </a>
        <a className="masthead__link" href={CONTACT}>
          Book a fitting
        </a>
      </header>

      <div className="rail" aria-hidden="true">
        <span className="rail__count">
          {pad(active)} <em>/</em> {pad(CHAPTERS.length - 1)}
        </span>
        <span className="rail__track">
          <span className="rail__fill" style={{ transform: `scaleY(${active / (CHAPTERS.length - 1)})` }} />
        </span>
      </div>

      <main className="story" id="top" ref={storyEl}>
        {CHAPTERS.map((c, i) => (
          <Chapter
            key={c.id}
            chapter={c}
            index={i}
            active={active === i}
            colour={colour}
            onColour={chooseColour}
            pattern={pattern}
            onPattern={choosePattern}
          />
        ))}
      </main>

      <footer className="footer">
        <div className="footer__brand">
          <span className="brand__diamond" aria-hidden="true" />
          {BRAND}
        </div>
        <nav className="footer__cols" aria-label="Footer">
          {FOOTER.map((col) => (
            <div key={col.heading}>
              <h3>{col.heading}</h3>
              <ul>
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href}>{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <p className="footer__legal">© {new Date().getFullYear()} {BRAND} Bespoke — Made by hand, for a lifetime</p>
      </footer>
    </div>
  );
}
