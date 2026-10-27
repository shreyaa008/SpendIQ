import { Utensils, ShoppingBag, Plane, Receipt, Film, HeartPulse, Tag, House, Car, BookOpen, Gift, Coffee, Smartphone, GraduationCap, Dumbbell, PawPrint, Wallet, Briefcase } from 'lucide-react';

export const ICONS = { utensils: Utensils, 'shopping-bag': ShoppingBag, plane: Plane, receipt: Receipt, film: Film, 'heart-pulse': HeartPulse, tag: Tag, home: House, car: Car, 'book-open': BookOpen, gift: Gift, coffee: Coffee, smartphone: Smartphone, 'graduation-cap': GraduationCap, dumbbell: Dumbbell, 'paw-print': PawPrint, wallet: Wallet, briefcase: Briefcase };
export const COLORS = ['#c2410c', '#b45309', '#15803d', '#0369a1', '#27389b', '#7c3aed', '#be185d', '#64748b', '#0f766e', '#a16207'];

export default function CategoryIcon({ icon = 'tag', color = '#64748b', size = 16, boxed = true }) {
  const I = ICONS[icon] ?? Tag;
  if (!boxed) return <I size={size} color={color} aria-hidden="true" />;
  return <span style={{ width: size + 14, height: size + 14, borderRadius: 8, background: `${color}1f`, color, display: 'grid', placeItems: 'center', flex: 'none' }}><I size={size} aria-hidden="true" /></span>;
}