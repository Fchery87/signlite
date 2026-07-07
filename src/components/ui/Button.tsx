import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

const styles = {
  primary: 'border border-accent bg-accent text-white hover:bg-[#3350B4] disabled:border-line disabled:bg-sunken disabled:text-quiet',
  secondary: 'border border-line bg-surface text-ink hover:bg-sunken',
  ghost: 'border border-transparent bg-transparent text-quiet hover:bg-sunken hover:text-ink'
} as const;

type Props = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: keyof typeof styles;
  }
>;

export function Button({ children, className = '', variant = 'primary', type = 'button', ...props }: Props) {
  return (
    <button
      type={type}
      className={`focus-ring inline-flex h-[30px] items-center justify-center rounded-md px-[14px] text-body font-medium transition-colors duration-100 ease-out disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
