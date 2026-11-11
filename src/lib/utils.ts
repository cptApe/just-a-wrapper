import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Register custom text-size tokens with tailwind-merge so it does not treat
// them as text colours. Sizes must merge with other sizes while coexisting
// with colour utilities such as text-destructive.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'title-page',
            'title-section',
            'title-card',
            'body-lg',
            'body',
            'meta',
            'count',
            'caption',
          ],
        },
      ],
      // The theme's button radius is a named radius utility. Without this entry
      // `cn('rounded-sm', 'rounded-button')` keeps both classes and the
      // stylesheet order decides, which is how skeleton pills rendered square.
      rounded: [{ rounded: ['button'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
