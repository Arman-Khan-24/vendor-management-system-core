export async function readOrderPhoto(file: File) {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Choose a JPEG or PNG photo below 3 MB.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('The photo could not be read.'));
    reader.readAsDataURL(file);
  });
  return { data, mimeType: file.type, name: file.name };
}
