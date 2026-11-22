import {motion,useReducedMotion} from 'motion/react';

export const workspaceEase = [.22, 1, .36, 1];
const entrance = {opacity: .72, y: 5};
const settled = {opacity: 1, y: 0};

export function useWorkspaceMotion() {
  const reduced = useReducedMotion();
  return {
    initial: reduced ? false : entrance,
    animate: settled,
    transition: {duration: reduced ? 0 : .2, ease: workspaceEase},
  };
}

export function MotionRow({children, ...props}) {
  const entranceProps = useWorkspaceMotion();
  const reduced = useReducedMotion();
  return <motion.li layout={reduced ? false : 'position'} {...entranceProps} {...props}>
    {children}
  </motion.li>;
}

export function MotionBar({horizontal = false, style, ...props}) {
  const reduced = useReducedMotion();
  const axis = horizontal ? 'scaleX' : 'scaleY';
  return <motion.span {...props}
    initial={reduced ? false : {[axis]: .15}}
    animate={{[axis]: 1}}
    transition={{duration: reduced ? 0 : .32, ease: workspaceEase}}
    style={{...style, originX: 0, originY: 1}}/>;
}
