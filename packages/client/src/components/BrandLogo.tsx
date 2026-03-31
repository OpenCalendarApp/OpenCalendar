interface BrandLogoProps {
  alt?: string;
  className?: string;
  variant?: 'horizontal' | 'icon' | 'stacked';
}

const brandAssetMap: Record<NonNullable<BrandLogoProps['variant']>, string> = {
  horizontal: '/horizontal.svg',
  icon: '/icon.svg',
  stacked: '/stacked.svg'
};

export function BrandLogo({
  alt = 'Calendar Genie',
  className,
  variant = 'horizontal'
}: BrandLogoProps): JSX.Element {
  return <img className={className} src={brandAssetMap[variant]} alt={alt} />;
}
