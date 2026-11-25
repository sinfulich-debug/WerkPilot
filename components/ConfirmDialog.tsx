type ConfirmDialogProps = {
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmDialog({
  title,
  message,
  cancelLabel = 'Abbrechen',
  confirmLabel = 'Löschen',
  confirmVariant = 'danger',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div className="wp-overlay fixed inset-0 z-[60] flex items-end sm:items-center justify-center overflow-y-auto bg-slate-950/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="wp-sheet mt-auto sm:my-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"
      >
        <h2 id="confirm-dialog-title" className="text-xl font-medium text-slate-900">
          {title}
        </h2>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-2xl px-4 py-2.5 text-sm font-medium text-white transition ${
              confirmVariant === 'danger' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
