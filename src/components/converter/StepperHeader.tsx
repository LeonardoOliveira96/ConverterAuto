import { Check } from 'lucide-react';
import { motion } from 'framer-motion';

const STEPS = [
  { label: 'Upload', icon: '📥' },
  { label: 'Tipo', icon: '📂' },
  { label: 'Mapeamento', icon: '🔗' },
  { label: 'Processamento', icon: '⚡' },
  { label: 'Resultado', icon: '📤' },
];

interface StepperHeaderProps {
  currentStep: number;
}

export function StepperHeader({ currentStep }: StepperHeaderProps) {
  return (
    <div className="flex items-center justify-between w-full max-w-3xl mx-auto mb-8">
      {STEPS.map((step, i) => {
        const isDone = i < currentStep;
        const isActive = i === currentStep;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <motion.div
                initial={false}
                animate={{
                  scale: isActive ? 1.15 : 1,
                  backgroundColor: isDone
                    ? 'hsl(var(--stepper-done))'
                    : isActive
                      ? 'hsl(var(--stepper-active))'
                      : 'hsl(var(--stepper-pending))',
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-primary-foreground shadow-md"
              >
                {isDone ? <Check className="w-5 h-5" /> : <span>{i + 1}</span>}
              </motion.div>
              <span className={`text-xs font-medium hidden sm:block ${isActive ? 'text-primary' : isDone ? 'text-success' : 'text-muted-foreground'}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 mx-2">
                <div className={`h-0.5 rounded-full transition-colors duration-300 ${isDone ? 'bg-success' : 'bg-border'}`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
