// IELTS Question Type Templates
// This file contains templates for different types of IELTS reading questions

const QuestionTypes = {
    
    // Multiple Choice Questions
    multipleChoice: function(questionNumber, questionText, options, correctAnswer) {
        const optionInputs = options.map((option, index) => {
            const value = String.fromCharCode(65 + index); // A, B, C, D...
            return `<label><input type="radio" name="q${questionNumber}" value="${value}"> ${value}) ${option}</label>`;
        }).join('\n        ');
        
        return `
    <div class="group">
      <h4>Question ${questionNumber}</h4>
      <p>${questionText}</p>
      <div class="multiple-choice">
        ${optionInputs}
      </div>
    </div>`;
    },
    
    // True/False/Not Given Questions
    trueFalseNotGiven: function(questionNumber, statement) {
        return `
    <div class="group">
      <h4>Question ${questionNumber}</h4>
      <p>${statement}</p>
      <div class="true-false-ng">
        <label><input type="radio" name="q${questionNumber}" value="TRUE"> TRUE</label>
        <label><input type="radio" name="q${questionNumber}" value="FALSE"> FALSE</label>
        <label><input type="radio" name="q${questionNumber}" value="NOT GIVEN"> NOT GIVEN</label>
      </div>
    </div>`;
    },
    
    // Yes/No/Not Given Questions
    yesNoNotGiven: function(questionNumber, statement) {
        return `
    <div class="group">
      <h4>Question ${questionNumber}</h4>
      <p>${statement}</p>
      <div class="true-false-ng">
        <label><input type="radio" name="q${questionNumber}" value="YES"> YES</label>
        <label><input type="radio" name="q${questionNumber}" value="NO"> NO</label>
        <label><input type="radio" name="q${questionNumber}" value="NOT GIVEN"> NOT GIVEN</label>
      </div>
    </div>`;
    },
    
    // Fill in the Blanks / Sentence Completion
    fillInBlanks: function(questionNumber, sentence, maxWords = 3) {
        const blankPattern = /___+/g;
        const sentenceWithInputs = sentence.replace(blankPattern, 
            `<input type="text" name="q${questionNumber}" class="fill-blank" placeholder="max ${maxWords} words">`);
        
        return `
    <div class="group">
      <h4>Question ${questionNumber}</h4>
      <p>Complete the sentence below. Choose <strong>NO MORE THAN ${maxWords.toUpperCase()} WORDS</strong> from the passage.</p>
      <p>${sentenceWithInputs}</p>
    </div>`;
    },
    
    // Matching Headings
    matchingHeadings: function(questionRange, paragraphs, headings) {
        const headingsList = headings.map((heading, index) => 
            `<li value="${index + 1}">${heading}</li>`).join('\n          ');
        
        const paragraphRows = paragraphs.map(para => {
            const options = headings.map((_, index) => 
                `<td><input type="radio" name="q${para.questionNumber}" value="${index + 1}"></td>`).join('');
            return `<tr><td>${para.label}</td>${options}</tr>`;
        }).join('\n        ');
        
        const headerCells = headings.map((_, index) => `<th>${index + 1}</th>`).join('');
        
        return `
    <div class="group">
      <h4>Questions ${questionRange}</h4>
      <p>Reading Passage has paragraphs. Choose the correct heading for each paragraph from the list of headings below.</p>
      <p>Write the correct number in the boxes on your answer sheet.</p>
      
      <div class="headings">
        <p><strong>List of Headings</strong></p>
        <ol>
          ${headingsList}
        </ol>
      </div>

      <table class="matching-table">
        <tr>
          <th>Paragraph</th>
          ${headerCells}
        </tr>
        ${paragraphRows}
      </table>
    </div>`;
    },
    
    // Matching Information
    matchingInformation: function(questionRange, statements, options) {
        const optionsList = options.map((option, index) => 
            `${String.fromCharCode(65 + index)} ${option}`).join(' &nbsp; ');
        
        const statementsList = statements.map(statement => {
            const optionInputs = options.map((_, index) => {
                const value = String.fromCharCode(65 + index);
                return `<label><input type="radio" name="q${statement.questionNumber}" value="${value}"> ${value}</label>`;
            }).join(' ');
            
            return `
        <li>${statement.text}<br>
          ${optionInputs}
        </li>`;
        }).join('\n      ');
        
        return `
    <div class="group">
      <h4>Questions ${questionRange}</h4>
      <p>Look at the following statements and the list below.</p>
      <p>Match each statement with the correct option.</p>
      <p><strong>Options:</strong> ${optionsList}</p>

      <ol start="${statements[0].questionNumber}">
      ${statementsList}
      </ol>
    </div>`;
    },
    
    // Summary Completion with Word Bank
    summaryWithWordBank: function(questionRange, summaryText, wordBank) {
        const wordBankList = wordBank.map(word => 
            `<span class="word-option">${word}</span>`).join(' ');
        
        return `
    <div class="group">
      <h4>Questions ${questionRange}</h4>
      <p>Complete the summary below. Choose words from the box below.</p>
      
      <div class="word-bank">
        <p><strong>Word Bank:</strong></p>
        <div class="word-options">
          ${wordBankList}
        </div>
      </div>
      
      <div class="summary-text">
        ${summaryText}
      </div>
    </div>`;
    },
    
    // Short Answer Questions
    shortAnswer: function(questionNumber, question, maxWords = 3) {
        return `
    <div class="group">
      <h4>Question ${questionNumber}</h4>
      <p>Answer the question below. Choose <strong>NO MORE THAN ${maxWords.toUpperCase()} WORDS</strong> from the passage.</p>
      <p><strong>${question}</strong></p>
      <input type="text" name="q${questionNumber}" class="fill-blank" placeholder="max ${maxWords} words" style="width: 200px;">
    </div>`;
    },
    
    // Diagram/Chart Completion
    diagramCompletion: function(questionRange, diagramDescription, labels) {
        const labelInputs = labels.map(label => 
            `<p>${label.position}: <input type="text" name="q${label.questionNumber}" class="fill-blank" placeholder="max 2 words"></p>`
        ).join('\n        ');
        
        return `
    <div class="group">
      <h4>Questions ${questionRange}</h4>
      <p>Complete the diagram below. Choose <strong>NO MORE THAN TWO WORDS</strong> from the passage for each answer.</p>
      
      <div class="diagram-description">
        <p><em>${diagramDescription}</em></p>
      </div>
      
      <div class="diagram-labels">
        ${labelInputs}
      </div>
    </div>`;
    },
    
    // Classification Questions
    classification: function(questionRange, items, categories) {
        const categoryList = categories.map((cat, index) => 
            `${String.fromCharCode(65 + index)} ${cat}`).join(' &nbsp; ');
        
        const itemsList = items.map(item => {
            const categoryInputs = categories.map((_, index) => {
                const value = String.fromCharCode(65 + index);
                return `<label><input type="radio" name="q${item.questionNumber}" value="${value}"> ${value}</label>`;
            }).join(' ');
            
            return `
        <li>${item.text}<br>
          ${categoryInputs}
        </li>`;
        }).join('\n      ');
        
        return `
    <div class="group">
      <h4>Questions ${questionRange}</h4>
      <p>Classify the following items according to the categories below.</p>
      <p><strong>Categories:</strong> ${categoryList}</p>

      <ol start="${items[0].questionNumber}">
      ${itemsList}
      </ol>
    </div>`;
    }
};

// Export for use in HTML generation
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuestionTypes;
} else {
    window.QuestionTypes = QuestionTypes;
}