import { SheetType } from '@/lib/erp-fields';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { Package, Users, Truck } from 'lucide-react';

interface StepTypeSelectionProps {
  selected: SheetType | null;
  onSelect: (type: SheetType) => void;
}

const TYPES: { type: SheetType; label: string; description: string; icon: React.ReactNode }[] = [
  { type: 'produto', label: 'Produto', description: 'Catálogo de produtos, estoque e preços', icon: <Package className="w-8 h-8" /> },
  { type: 'cliente', label: 'Cliente', description: 'Base de clientes com dados cadastrais', icon: <Users className="w-8 h-8" /> },
  { type: 'fornecedor', label: 'Fornecedor', description: 'Cadastro de fornecedores e contatos', icon: <Truck className="w-8 h-8" /> },
];

export function StepTypeSelection({ selected, onSelect }: StepTypeSelectionProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {TYPES.map(({ type, label, description, icon }) => {
        const isSelected = selected === type;
        return (
          <Card
            key={type}
            onClick={() => onSelect(type)}
            className={`p-8 cursor-pointer transition-all duration-200 hover:shadow-lg ${
              isSelected
                ? 'ring-2 ring-primary bg-primary/5 shadow-lg'
                : 'hover:bg-secondary/50'
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
              isSelected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>
              {icon}
            </div>
            <h3 className="font-heading font-semibold text-lg text-foreground">{label}</h3>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </Card>
        );
      })}
    </motion.div>
  );
}
