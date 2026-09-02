// Identity-question detection for the "truthful bare answer" bypass.
//
// Some agent-tuned models (for example a DeepSeek coding model distilled from
// Claude-Code-style transcripts) flip into a different persona as soon as they
// are invoked inside a tool-calling agent loop: asked "what model are you",
// they answer Claude even though the bare endpoint truthfully answers DeepSeek.
//
// Rather than injecting an identity system prompt into every request, ChatService
// routes *only* messages this detector recognises as identity/self questions to a
// bare streamChat request with no tools and no history — byte-for-byte the same
// input as the raw API call that already self-identifies truthfully. Everything
// else is untouched. This module is pure so it can be unit tested and reused.

export interface IdentityQuestionPolicy {
  /** Master switch. When disabled the detector never matches. */
  enabled: boolean;
  /** Additional phrases (case-insensitive, whitespace ignored) to treat as identity questions. */
  extraKeywords?: readonly string[];
}

// Identity questions are short. Longer messages are coding requests that mention
// the assistant or the word "model" and must keep the full tool-calling path.
const MAX_QUESTION_LENGTH = 80;

// Phrases that ask about the assistant's identity / provider / model name.
// Compared against the message with all whitespace removed and lowercased, so
// Chinese and Latin phrases can be written here without worrying about spacing.
const IDENTITY_KEYWORDS: readonly string[] = [
  // Chinese — what/who you are.
  '你是什么模型',
  '你是什么大模型',
  '你是哪个模型',
  '你用的是什么模型',
  '你用的什么模型',
  '你是什么版本的模型',
  '你是什么型号',
  '你的型号是什么',
  '你的底座模型是什么',
  '你的底层模型是什么',
  '你背后是什么模型',
  '你的后端模型是什么',
  '你是谁',
  '你是谁啊',
  '你是谁开发的',
  '你是由谁开发的',
  '你是由谁开发',
  '你由谁开发',
  '是谁开发了你',
  '谁开发了你',
  '谁创造了你',
  '谁制造了你',
  '你的开发者是谁',
  '你的创造者是谁',
  '你的开发商是谁',
  '你是哪家公司开发的',
  '你是哪家公司',
  '你是哪个公司',
  '你是哪个公司的',
  '你属于哪家公司',
  '你属于哪个公司',
  '你的公司是哪个',
  '你的公司是哪家',
  '你叫什么',
  '你叫啥',
  '你叫什么名字',
  '你的名字是什么',
  '你的名字叫',
  '介绍一下你自己',
  '介绍下你自己',
  '自我介绍一下',
  '简单介绍下自己',
  '你是claude吗',
  '你是claude',
  '你是gpt吗',
  '你是gpt',
  '你是openai吗',
  '你是openai',
  '你是anthropic吗',
  '你是anthropic',
  '你是deepseek吗',
  '你是deepseek',
  '你是不是claude',
  '你是不是gpt',
  '你是不是openai',
  '你是不是anthropic',
  '你是不是deepseek',
  '你是哪个ai',
  '你是什么ai',
  // English.
  'whatmodelareyou',
  'whichmodelareyou',
  'whatmodel',
  'whatareyou',
  'whoareyou',
  'whomadeyou',
  'whocreatedyou',
  'whobuiltyou',
  'whatareyoucalled',
  'whatisyourname',
  'whatsyourname',
  'introduceyourself',
  'whodevelopedyou',
  'whoyourdeveloper',
  'whoisyourdeveloper',
  'whoisyourcreator',
  'whatcompany',
  'whichcompany',
  'areyouclaude',
  'areyougpt',
  'areyouopenai',
  'areyouanthropic',
  'areyoudeepseek',
  'whichmodelare',
  'whatpowersyou',
  'whatsyourmodel',
  'yourbasemodel'
];

// Action/task signals that mean the message is really a coding request which
// happens to mention the assistant or "model" — keep it on the normal path.
const TASK_KEYWORDS: readonly string[] = [
  '帮我',
  '请帮我',
  '请你',
  '请写',
  '实现',
  '重构',
  '修复',
  '调试',
  '如何',
  '怎么',
  '为什么',
  '翻译',
  '总结一下',
  '概括一下',
  '生成一段',
  '分析一下',
  '解释一下',
  '运行',
  '编译',
  '报错',
  '出错',
  '异常',
  '测试一下',
  '写代码',
  '写一个',
  '写个',
  '写程序',
  '写脚本',
  'import',
  'function',
  'def',
  'console',
  'npm',
  'git',
  '```',
  'bug',
  'error'
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

export function isIdentityQuestion(raw: string, policy?: IdentityQuestionPolicy): boolean {
  const effective: IdentityQuestionPolicy = policy ?? { enabled: true };
  if (!effective.enabled) return false;
  const text = raw.trim();
  if (!text || text.length > MAX_QUESTION_LENGTH) return false;

  const compact = normalize(text);
  const keywords = [...IDENTITY_KEYWORDS, ...(effective.extraKeywords ?? [])];
  const matched = keywords.some(keyword => compact.includes(normalize(keyword)));
  if (!matched) return false;

  // If the message also asks for real work, answer it normally (tools included).
  const hasTask = TASK_KEYWORDS.some(keyword => compact.includes(normalize(keyword)));
  return !hasTask;
}
