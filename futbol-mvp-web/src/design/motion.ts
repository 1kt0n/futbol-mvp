export const motion = {
  fast: 150,
  base: 220,
  slow: 320,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
};

export function transition(ms = motion.base, property = "all") {
  return `${property} ${ms}ms ${motion.easing}`;
}

