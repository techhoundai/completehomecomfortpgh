export interface NavLink {
  label: string;
  href: string;
  children?: NavLink[];
}

export const mainNav: NavLink[] = [
  {
    label: "Services",
    href: "/services/",
    children: [
      { label: "Heating", href: "/heating/" },
      { label: "Cooling", href: "/cooling/" },
      { label: "Repair", href: "/repair/" },
      { label: "Maintenance", href: "/maintenance/" },
      { label: "Installation", href: "/installation/" },
    ],
  },
  {
    label: "Why Us",
    href: "#",
    children: [
      { label: "Gallery", href: "/gallery/" },
      { label: "Testimonials", href: "/testimonials/" },
    ],
  },
  {
    label: "Resources",
    href: "#",
    children: [{ label: "Financing", href: "/financing/" }],
  },
  { label: "About", href: "/about/" },
  { label: "Contact", href: "/contact/" },
];

export const quickLinks = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services/" },
  { label: "Gallery", href: "/gallery/" },
  { label: "Testimonials", href: "/testimonials/" },
  { label: "Financing", href: "/financing/" },
  { label: "About", href: "/about/" },
  { label: "Contact", href: "/contact/" },
];

export const serviceLinks = [
  { label: "Heating", href: "/heating/" },
  { label: "Cooling", href: "/cooling/" },
  { label: "Repair", href: "/repair/" },
  { label: "Maintenance", href: "/maintenance/" },
  { label: "Installation", href: "/installation/" },
  { label: "Financing", href: "/financing/" },
];
