import { cn } from '@/lib/utils';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

// The 24px default sits in the width and height attributes, which any size
// class overrides, so container rules like `[&_svg:not([class*='size-'])]` apply.
const DEFAULT_ICON_PX = 24;
const lineIconStyle = 'stroke-2';
const solidIconStyle = 'stroke-0';

export const createIcon = (paths: string[], isSolid: boolean = false) => {
  // eslint-disable-next-line react/display-name -- the generated icon inherits its exported factory name
  return ({ className, ...props }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={DEFAULT_ICON_PX}
      height={DEFAULT_ICON_PX}
      fill={isSolid ? 'currentColor' : 'none'}
      stroke={isSolid ? 'none' : 'currentColor'}
      className={cn(isSolid ? solidIconStyle : lineIconStyle, className)}
      {...props}
    >
      {paths.map((path, index) => (
        <path
          key={index}
          d={path}
          {...(isSolid
            ? { fillRule: 'evenodd', clipRule: 'evenodd' }
            : { strokeLinecap: 'round', strokeLinejoin: 'round' })}
        />
      ))}
    </svg>
  );
};

export type Icon = ReturnType<typeof createIcon>;
