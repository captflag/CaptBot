
export class GuardrailService {
  private static readonly PROHIBITED_PATTERNS = [
    /ignore (all )?previous/i,
    /system instruction/i,
    /bypass/i,
    /reveal your (secret|internal)/i,
    /<script/i,
    /DROP TABLE/i,
  ];

  static validate(input: string): { isValid: boolean; reason?: string } {
    const trimmed = input.trim();
    
    if (trimmed.length < 2) {
      return { isValid: false, reason: 'MINIMUM_ENTROPY_NOT_MET' };
    }

    if (trimmed.length > 2000) {
      return { isValid: false, reason: 'BUFFER_OVERFLOW_PREVENTION' };
    }

    for (const pattern of this.PROHIBITED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { isValid: false, reason: 'PROTOCOL_INJECTION_DETECTED' };
      }
    }

    return { isValid: true };
  }
}
