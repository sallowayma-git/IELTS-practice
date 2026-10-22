/**
 * Mood mascots: global brand characters (coloured blobs with ink faces).
 * viewBox 0 0 64 64, explicit fills. Rendered by MoodMascot.vue (soft crayon).
 *
 * Intended use (placements not decided yet, do not add without a design call):
 *   - empty states      e.g. "no notes yet" -> calm / sensitive
 *   - onboarding        first-run welcome -> excited / joyful
 *   - feedback moments  result / streak / error -> proud, grateful, confused
 */
export const MOODS = {
  'excited': `
      <path fill="#FFC21A" stroke="none" d="M32 7a25 25 0 1 1 0 50a25 25 0 1 1 0-50Z"/>
      <circle cx="25" cy="30" r="4.6" fill="#fff"/>
      <circle cx="23.2" cy="28.6" r="2.3" fill="#1E1A16"/>
      <circle cx="39" cy="30" r="4.6" fill="#fff"/>
      <circle cx="37.2" cy="28.6" r="2.3" fill="#1E1A16"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M26 40q6 6 12 0"/>
    `,
  'joyful': `
      <path fill="#FF7AB6" stroke="none" d="M32 56C12 44 6 32 8 24C10 15 22 11 32 22C42 11 54 15 56 24C58 32 52 44 32 56Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M22 31q3 3.5 6 0M36 31q3 3.5 6 0"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M26 41q6 5 12 0"/>
    `,
  'grateful': `
      <path fill="#9C6ADE" stroke="none" d="M8 34a24 20 0 1 0 48 0a24 20 0 1 0-48 0Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M22 32q3 3.5 6 0M36 32q3 3.5 6 0"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M25 42q7 4 14 0"/>
    `,
  'energized': `
      <path fill="#FF7A1A" stroke="none" d="M10 56V24a7 7 0 0 1 14 0a8 8 0 0 1 16 0a7 7 0 0 1 14 0V56a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M22 36q3 3.5 6 0M36 36q3 3.5 6 0"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M27 44q5 4 10 0"/>
    `,
  'calm': `
      <path fill="#22A660" stroke="none" d="M8 40C8 30 18 26 32 26C46 26 56 30 56 40C56 52 46 56 32 56C18 56 8 52 8 40Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M22 38q3 3.5 6 0M36 38q3 3.5 6 0"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M28 46q4 2 8 0"/>
    `,
  'focused': `
      <path fill="#2AA8F2" stroke="none" d="M22 7H42L57 22V42L42 57H22L7 42V22Z"/>
      <circle cx="25" cy="31" r="3.6" fill="#fff"/>
      <circle cx="25" cy="31" r="2" fill="#1E1A16"/>
      <circle cx="39" cy="31" r="3.6" fill="#fff"/>
      <circle cx="39" cy="31" r="2" fill="#1E1A16"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M20 25h9M35 25h9M27 43h10"/>
    `,
  'sensitive': `
      <path fill="#F4A6C9" stroke="none" d="M32 7C32 7 14 28 14 40A18 18 0 0 0 50 40C50 28 32 7 32 7Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M22 36q3 3.5 6 0M36 36q3 3.5 6 0"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M27 45q2.5-2 5 0t5 0"/>
    `,
  'confused': `
      <path fill="#1F6FE5" stroke="none" d="M32 8C48 8 58 20 56 36C54 52 44 58 30 56C14 54 6 44 8 30C10 16 20 8 32 8Z"/>
      <circle cx="25" cy="31" r="4.2" fill="#fff"/>
      <circle cx="23" cy="30" r="2.1" fill="#1E1A16"/>
      <circle cx="39" cy="31" r="4.2" fill="#fff"/>
      <circle cx="41" cy="33" r="2.1" fill="#1E1A16"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M26 44q3-3 6 0t6 0"/>
    `,
  'bored': `
      <path fill="#1E8F4E" stroke="none" d="M18 24H46a12 12 0 0 1 0 24H18a12 12 0 0 1 0-24Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M21 32h8M35 32h8M28 42h8"/>
    `,
  'stressed': `
      <path fill="#FFA41C" stroke="none" d="M32 8L56 50Q58 56 52 56H12Q6 56 8 50Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M21 28l6 4-6 4M43 28l-6 4 6 4"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M28 46h8"/>
    `,
  'tired': `
      <path fill="#B48ADF" stroke="none" d="M22 26H42A14 14 0 0 1 56 40A14 14 0 0 1 42 54H22A14 14 0 0 1 8 40A14 14 0 0 1 22 26Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M21 33q4-3 8 0M35 33q4-3 8 0"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M28 44h8"/>
    `,
  'angry': `
      <path fill="#FF5A1F" stroke="none" d="M17 7H47A10 10 0 0 1 57 17V47A10 10 0 0 1 47 57H17A10 10 0 0 1 7 47V17A10 10 0 0 1 17 7Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M18 24l12 4M46 24l-12 4M26 46h12"/>
      <circle cx="25" cy="33" r="3.6" fill="#fff"/>
      <circle cx="25" cy="33" r="2" fill="#1E1A16"/>
      <circle cx="39" cy="33" r="3.6" fill="#fff"/>
      <circle cx="39" cy="33" r="2" fill="#1E1A16"/>
    `,
  'insecure': `
      <path fill="#FFC21A" stroke="none" d="M32 7L52 27Q58 33 52 39L36 55Q32 59 28 55L12 39Q6 33 12 27Z"/>
      <circle cx="25" cy="31" r="4.2" fill="#fff"/>
      <circle cx="23" cy="31.5" r="2" fill="#1E1A16"/>
      <circle cx="39" cy="31" r="4.2" fill="#fff"/>
      <circle cx="37" cy="31.5" r="2" fill="#1E1A16"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M27 44h10"/>
    `,
  'hurt': `
      <path fill="#FF7A1A" stroke="none" d="M14 18Q32 8 50 18Q58 22 58 32Q58 42 50 46Q32 56 14 46Q6 42 6 32Q6 22 14 18Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M21 31q4 3 8 0M35 31q4 3 8 0M26 45q6-5 12 0"/>
    `,
  'guilty': `
      <path fill="#FFC21A" stroke="none" d="M8 56A48 48 0 0 1 56 8V56Z"/>
      <circle cx="26" cy="37" r="4" fill="#fff"/>
      <circle cx="24.5" cy="38.5" r="2" fill="#1E1A16"/>
      <circle cx="40" cy="37" r="4" fill="#fff"/>
      <circle cx="38.5" cy="38.5" r="2" fill="#1E1A16"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M27 48q2.5-2 5 0t5 0"/>
    `,
  'proud': `
      <path fill="#1F6FE5" stroke="none" d="M10 12H54V34Q54 50 32 60Q10 50 10 34Z"/>
      <path fill="none" stroke="#1E1A16" stroke-width="2.5" stroke-linecap="round" d="M22 30q3 3.5 6 0M36 30q3 3.5 6 0M24 40q8 7 16 0"/>
    `,
}

export const MOOD_NAMES = Object.keys(MOODS)

/** Chinese name per mood; the tooltip pairs it with the English key. */
export const MOOD_LABELS = {
  excited: '兴奋',
  joyful: '开心',
  grateful: '感恩',
  energized: '元气满满',
  calm: '平静',
  focused: '专注',
  sensitive: '敏感',
  confused: '困惑',
  bored: '无聊',
  stressed: '压力大',
  tired: '疲惫',
  angry: '生气',
  insecure: '不安',
  hurt: '受伤',
  guilty: '内疚',
  proud: '骄傲'
}
