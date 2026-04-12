import { BackupEntry } from '@/lib/converter-types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, RotateCcw, Archive } from 'lucide-react';
import * as XLSX from 'xlsx';

interface BackupHistoryProps {
  backups: BackupEntry[];
  onRestore: (backup: BackupEntry) => void;
}

export function BackupHistory({ backups, onRestore }: BackupHistoryProps) {
  const handleDownload = (backup: BackupEntry) => {
    const ws = XLSX.utils.aoa_to_sheet(backup.data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Backup');
    XLSX.writeFile(wb, backup.fileName);
  };

  const typeLabels: Record<string, string> = { produto: 'Produto', cliente: 'Cliente', fornecedor: 'Fornecedor' };

  if (backups.length === 0) {
    return (
      <Card className="bg-card p-12 text-center">
        <Archive className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">Nenhum backup encontrado.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {backups.map((b) => (
        <Card key={b.id} className="bg-card p-5 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="font-heading font-semibold text-foreground truncate">{b.fileName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(b.date).toLocaleString('pt-BR')} • {b.rowCount.toLocaleString('pt-BR')} linhas
            </p>
          </div>
          <Badge variant="secondary">{typeLabels[b.type]}</Badge>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onRestore(b)} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Restaurar
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleDownload(b)} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Baixar
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
