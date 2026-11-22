export async function loadSample(filename: string) {
  const response = await fetch('/' + filename);
  if (!response.ok) throw new Error('Sample unavailable');
  return new File([await response.blob()], filename, { type: 'image/png' });
}
