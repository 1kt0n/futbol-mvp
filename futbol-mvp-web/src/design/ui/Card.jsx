import { cn } from "../cn.js";

export default function Card({ className = "", children, ...rest }) {
  return (
    <section className={cn("app-card p-4", className)} {...rest}>
      {children}
    </section>
  );
}

