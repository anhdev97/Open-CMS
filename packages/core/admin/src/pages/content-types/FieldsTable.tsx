import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { t } from '../../i18n';
import type { FieldDefinition } from '../../lib/types';
import { cn } from '../../lib/utils';
import { BoolMark } from './shared';

interface FieldsTableProps {
  fields: FieldDefinition[];
  /** Fields as stored; a renamed field shows "rename a → b". */
  persisted?: FieldDefinition[];
  /** Edit mode: drag handle, move, edit and remove actions. */
  onEdit?: (index: number) => void;
  onRemove?: (index: number) => void;
  onMove?: (from: number, to: number) => void;
}

/** Fields in display order: name, kind, required, localizable, readOnly. Rows drag to reorder in edit mode. */
export function FieldsTable({ fields, persisted, onEdit, onRemove, onMove }: FieldsTableProps) {
  const editing = !!onMove;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const label = (f: FieldDefinition) => f.name || t('builder.newField');

  const dragProps = (i: number) =>
    editing
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            setDragFrom(i);
            e.dataTransfer?.setData('text/plain', String(i));
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          },
          onDragOver: (e: DragEvent) => {
            if (dragFrom === null) return;
            e.preventDefault();
            setDragOver(i);
          },
          onDragEnd: () => {
            setDragFrom(null);
            setDragOver(null);
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            if (dragFrom !== null && dragFrom !== i) onMove!(dragFrom, i);
            setDragFrom(null);
            setDragOver(null);
          },
        }
      : {};

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {editing && <TableHead className="w-8" />}
          <TableHead>{t('builder.fieldName')}</TableHead>
          <TableHead>{t('builder.fieldKind')}</TableHead>
          <TableHead>{t('builder.required')}</TableHead>
          <TableHead>{t('builder.localizable')}</TableHead>
          <TableHead>{t('contentTypes.readOnlyColumn')}</TableHead>
          {editing && <TableHead className="w-40" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {fields.map((f, i) => {
          const before = persisted?.find((p) => p.id === f.id);
          return (
            <TableRow
              key={f.id}
              data-field={f.name}
              className={cn(dragFrom === i && 'opacity-50', dragOver === i && dragFrom !== i && 'border-t-2 border-t-primary')}
              {...dragProps(i)}
            >
              {editing && (
                <TableCell className="cursor-grab text-muted-foreground" title={t('contentTypes.dragHandle', { name: label(f) })}>
                  <GripVerticalIcon className="size-4" aria-hidden="true" />
                </TableCell>
              )}
              <TableCell>
                <div className="font-mono text-sm">{label(f)}</div>
                {(f.label || (before && before.name !== f.name)) && (
                  <div className="text-xs text-muted-foreground">
                    {f.label}
                    {f.label && before && before.name !== f.name && ' · '}
                    {before && before.name !== f.name && t('builder.renameField', { from: before.name, to: f.name })}
                  </div>
                )}
              </TableCell>
              <TableCell>{t(`builder.kinds.${f.kind}`)}</TableCell>
              <TableCell>
                <BoolMark value={f.required} label={t('builder.required')} />
              </TableCell>
              <TableCell>
                <BoolMark value={f.localizable} label={t('builder.localizable')} />
              </TableCell>
              <TableCell>
                <BoolMark value={!!f.readOnly} label={t('contentTypes.readOnlyColumn')} />
              </TableCell>
              {editing && (
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t('builder.moveUp', { name: label(f) })} disabled={i === 0} onClick={() => onMove!(i, i - 1)}>
                      <ArrowUpIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('builder.moveDown', { name: label(f) })}
                      disabled={i === fields.length - 1}
                      onClick={() => onMove!(i, i + 1)}
                    >
                      <ArrowDownIcon aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t('contentTypes.editField', { name: label(f) })} onClick={() => onEdit?.(i)}>
                      <PencilIcon aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t('builder.removeField', { name: label(f) })} onClick={() => onRemove?.(i)}>
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Moves `fields[from]` to position `to` (drag and drop, move up / down). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
