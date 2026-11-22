import { useEffect, useMemo } from 'react';
import { t, useLang } from '../i18n';
import { cx } from './ui';
import { CameraIcon, ImageIcon } from './icons';

/**
 * Two native entry points instead of one: `capture` opens the camera directly on iOS and Android but hides the photo
 * library, where payment screenshots usually live. No custom camera UI: the system camera is faster and more reliable.
 */
export function PhotoButtons({
  onFiles,
  multiple = false,
  disabled,
  highlight,
  labelFor,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  /** pulse the camera button (the agent asked for a photo) */
  highlight?: boolean;
  /** accessible name prefix, e.g. what the photo is for */
  labelFor?: string;
}) {
  useLang();
  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = ''; // choosing the same file again must still fire
    if (files.length) onFiles(files);
  };
  const chip = 'choice-chip relative inline-flex min-h-11 cursor-pointer items-center gap-1.5';
  return (
    <div className="flex flex-wrap gap-2">
      <label className={cx(chip, highlight && 'animate-pulse bg-amber-100', disabled && 'opacity-50')}>
        <CameraIcon />
        {t('common.photo.camera')}
        <input
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          aria-label={labelFor ? `${labelFor} · ${t('common.photo.camera')}` : t('common.photo.camera')}
          data-testid="photo-camera"
          onChange={pick}
        />
      </label>
      <label className={cx(chip, disabled && 'opacity-50')}>
        <ImageIcon />
        {t('common.photo.gallery')}
        <input
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          type="file"
          accept="image/*"
          multiple={multiple}
          disabled={disabled}
          aria-label={labelFor ? `${labelFor} · ${t('common.photo.gallery')}` : t('common.photo.gallery')}
          data-testid="photo-gallery"
          onChange={pick}
        />
      </label>
    </div>
  );
}

/** Selected photos with thumbnails; each can be removed, and the buttons add or replace photos. */
export function PhotoPicker({
  files,
  onChange,
  max = 1,
  disabled,
  highlight,
  large,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max?: number;
  disabled?: boolean;
  highlight?: boolean;
  large?: boolean;
}) {
  useLang();
  const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);
  const add = (picked: File[]) => onChange(max === 1 ? picked.slice(0, 1) : [...files, ...picked].slice(0, max));
  return (
    <div className="space-y-2" data-testid="photo-picker">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file, i) => (
            <li key={`${file.name}-${file.size}-${i}`} className="relative">
              <img
                src={urls[i]}
                alt={t('common.photo.thumb', { n: i + 1 })}
                className={cx('rounded-lg border border-slate-200 object-cover', large ? 'h-40 w-40' : 'h-20 w-20')}
              />
              <button
                type="button"
                className="absolute -right-1 -top-1 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/80 text-lg text-white"
                aria-label={t('common.photo.remove', { n: i + 1 })}
                data-testid="photo-remove"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length < max || max === 1 ? <PhotoButtons onFiles={add} multiple={max > 1} disabled={disabled} highlight={highlight} /> : null}
      {max > 1 && files.length > 0 && <p className="text-xs text-slate-500">{t('common.photo.count', { count: files.length, max })}</p>}
    </div>
  );
}
