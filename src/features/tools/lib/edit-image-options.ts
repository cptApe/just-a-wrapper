import type { EditImageInput } from '@/features/tool-catalog/edit-image';

type EditSize = Extract<EditImageInput, { operation: 'edit' }>['image_size'];
const EDIT_SIZES: Record<Exclude<EditSize, 'auto'>, `${number}x${number}`> = {
  square: '1024x1024',
  portrait_4_3: '1024x1536',
  portrait_16_9: '864x1536',
  landscape_4_3: '1536x1024',
  landscape_16_9: '1536x864',
};

export function editImageOptions(input: EditImageInput) {
  if (input.operation === 'edit') {
    // The transparent model accepts only square and 3:2 output dimensions.
    const size =
      input.background === 'transparent' && input.image_size === 'portrait_16_9'
        ? '1024x1536'
        : input.background === 'transparent' && input.image_size === 'landscape_16_9'
          ? '1536x1024'
          : input.image_size === 'auto'
            ? undefined
            : EDIT_SIZES[input.image_size];
    return {
      prompt: input.prompt,
      background: input.background,
      ...(size ? { size } : {}),
    };
  }
  if (input.operation === 'remove_background') {
    return {
      prompt: 'Remove the background. Preserve the subject and return a transparent PNG.',
      background: 'transparent' as const,
    };
  }
  return {
    prompt:
      'Enhance fine detail and sharpness while preserving composition. Do not add content. Return the image at the largest supported size for its aspect ratio.',
    background: 'auto' as const,
  };
}
