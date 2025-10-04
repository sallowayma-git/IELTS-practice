const Database = require('better-sqlite3')
const { v4: uuidv4 } = require('uuid')

// 连接数据库
const db = new Database('./data/ielts-writing.db')

// 插入示例题目
const topics = [
  {
    id: uuidv4(),
    title: '环境问题与个人责任',
    type: 'Task 2',
    content: `
      <p><strong>题目：</strong></p>
      <p>Environmental problems are too big for individual countries and individual people to address. In other words, we have reached the stage where the only way to protect the environment is at an international level.</p>
      <p><strong>To what extent do you agree or disagree with this statement?</strong></p>
      <p><strong>要求：</strong>至少250词</p>
    `,
    min_words: 250,
    time_limit: 2400,
    difficulty: 'medium'
  },
  {
    id: uuidv4(),
    title: '教育投资分析',
    type: 'Task 2',
    content: `
      <p><strong>题目：</strong></p>
      <p>Some people believe that governments should spend more money on arts and culture, while others think that this money should be spent on public services such as healthcare and education.</p>
      <p><strong>Discuss both views and give your own opinion.</strong></p>
      <p><strong>要求：</strong>至少250词</p>
    `,
    min_words: 250,
    time_limit: 2400,
    difficulty: 'medium'
  },
  {
    id: uuidv4(),
    title: '城市人口增长图表',
    type: 'Task 1',
    content: `
      <p><strong>题目：</strong></p>
      <p>The chart below shows the percentage of urban population in four different countries from 1970 to 2020.</p>
      <p><strong>Summarise the information by selecting and reporting the main features, and make comparisons where relevant.</strong></p>
      <p><strong>要求：</strong>至少150词</p>
      <p><strong>图表数据：</strong></p>
      <ul>
        <li>Country A: 30% (1970) → 45% (1990) → 60% (2020)</li>
        <li>Country B: 40% (1970) → 55% (1990) → 75% (2020)</li>
        <li>Country C: 25% (1970) → 35% (1990) → 50% (2020)</li>
        <li>Country D: 50% (1970) → 65% (1990) → 80% (2020)</li>
      </ul>
    `,
    min_words: 150,
    time_limit: 1200,
    difficulty: 'easy'
  },
  {
    id: uuidv4(),
    title: '科技对社会的影响',
    type: 'Task 2',
    content: `
      <p><strong>题目：</strong></p>
      <p>Some people think that technology has made our lives more complex, while others believe it has actually made our lives simpler.</p>
      <p><strong>Discuss both views and give your own opinion.</strong></p>
      <p><strong>要求：</strong>至少250词</p>
    `,
    min_words: 250,
    time_limit: 2400,
    difficulty: 'medium'
  },
  {
    id: uuidv4(),
    title: '工作流程图',
    type: 'Task 1',
    content: `
      <p><strong>题目：</strong></p>
      <p>The diagram below shows the process of recycling plastic bottles.</p>
      <p><strong>Summarise the information by selecting and reporting the main features, and make comparisons where relevant.</strong></p>
      <p><strong>要求：</strong>至少150词</p>
      <p><strong>流程步骤：</strong></p>
      <ol>
        <li>Collection of plastic bottles</li>
        <li>Sorting by color and type</li>
        <li>Cleaning and washing</li>
        <li>Shredding into small pieces</li>
        <li>Melting and forming pellets</li>
        <li>Manufacturing new products</li>
      </ol>
    `,
    min_words: 150,
    time_limit: 1200,
    difficulty: 'easy'
  },
  {
    id: uuidv4(),
    title: '国际旅行的利弊',
    type: 'Task 2',
    content: `
      <p><strong>题目：</strong></p>
      <p>International tourism has brought enormous benefit to many places. At the same time, there is concern about its impact on local inhabitants and the environment.</p>
      <p><strong>Do the disadvantages of international tourism outweigh the advantages?</strong></p>
      <p><strong>要求：</strong>至少250词</p>
    `,
    min_words: 250,
    time_limit: 2400,
    difficulty: 'hard'
  }
]

// 插入题目数据
const stmt = db.prepare(`
  INSERT OR REPLACE INTO topics (
    id, title, type, content, min_words, time_limit, difficulty, is_active, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
`)

console.log('开始插入题目数据...')

topics.forEach((topic, index) => {
  try {
    stmt.run(
      topic.id,
      topic.title,
      topic.type,
      topic.content,
      topic.min_words,
      topic.time_limit,
      topic.difficulty
    )
    console.log(`✅ 插入题目 ${index + 1}: ${topic.title}`)
  } catch (error) {
    console.error(`❌ 插入题目失败: ${topic.title}`, error.message)
  }
})

console.log('题目数据插入完成！')
console.log(`总共插入了 ${topics.length} 个题目`)

// 关闭数据库连接
db.close()