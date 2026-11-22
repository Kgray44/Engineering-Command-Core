import {motion} from 'motion/react';
import {useCardMotion} from './card-motion.jsx';
import {useEffect,useRef,useState} from 'react';

export function SectionNavigation({label, sections, onJump}) {
  const nav = useRef(null);
  const interaction = useCardMotion(true);
  const [active, setActive] = useState(null);
  const enabledIds = sections.filter(section => !section.disabled).map(section => section.id).join(' ');

  useEffect(() => {
    const ids = enabledIds.split(' ').filter(Boolean);
    let frame = 0;
    function update() {
      frame = 0;
      if (!nav.current) return;
      const line = nav.current.getBoundingClientRect().bottom + 28;
      let closest = null;
      let top = -Infinity;
      for (const id of ids) {
        const panel = document.getElementById(id);
        if (!panel?.getClientRects().length) continue;
        const position = panel.getBoundingClientRect().top;
        if (position <= line && position > top) {
          closest = id;
          top = position;
        }
      }
      setActive(closest);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    schedule();
    window.addEventListener('scroll', schedule, {passive:true});
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [enabledIds]);

  return <nav ref={nav} className="task-section-nav workspace-section-nav" aria-label={label}>
    {sections.map(section => <motion.button {...(section.disabled ? {} : interaction)} key={section.id} type="button" className="quiet-button"
      disabled={section.disabled} aria-current={active === section.id ? 'location' : undefined}
      onClick={() => onJump(section.id)}>{section.label}</motion.button>)}
  </nav>;
}
