export interface CharacterProfile {
  id: string;
  name: string;
  identity: string;
  age: string;
  face: string;
  hairstyle: string;
  clothing: string;
  accessories: string;
  bodyProportions: string;
  referenceImageMediaId?: string;
  referenceImagePath?: string;
}

export class CharacterMemoryService {
  private characters: Map<string, CharacterProfile> = new Map();

  public registerCharacter(character: CharacterProfile): void {
    this.characters.set(character.name.toLowerCase(), character);
  }

  public getCharacter(name: string): CharacterProfile | undefined {
    return this.characters.get(name.toLowerCase());
  }

  public getAllCharacters(): CharacterProfile[] {
    return Array.from(this.characters.values());
  }

  public clear(): void {
    this.characters.clear();
  }

  public getConsistencyPromptDescription(): string {
    if (this.characters.size === 0) return '';

    return Array.from(this.characters.values())
      .map((c) => {
        return `CHARACTER CONSISTENCY REQUIREMENT FOR [${c.name}]:
- Identity: ${c.identity}
- Age: ${c.age}
- Facial Features: ${c.face}
- Hair Style: ${c.hairstyle}
- Clothing: ${c.clothing}
- Accessories: ${c.accessories}
- Body Proportions: ${c.bodyProportions}`;
      })
      .join('\n\n');
  }

  public formatCharacterPromptBlock(characterName?: string): string {
    if (!characterName) {
      return this.getConsistencyPromptDescription();
    }

    const char = this.getCharacter(characterName);
    if (!char) {
      // Return general memory if exact match not found
      return this.getConsistencyPromptDescription();
    }

    return `CHARACTER PROFILE FOR [${char.name}]: ${char.identity}, ${char.age}, face features: ${char.face}, hair: ${char.hairstyle}, wearing: ${char.clothing}, accessories: ${char.accessories}, proportions: ${char.bodyProportions}. MUST MAINTAIN EXACT VISUAL IDENTITY MATCH.`;
  }
}
