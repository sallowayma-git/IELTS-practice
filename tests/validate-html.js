// Simple HTML validation script
const fs = require('fs');

try {
    const htmlContent = fs.readFileSync('improved-working-system.html', 'utf8');
    
    // Check for basic HTML structure
    const hasDoctype = htmlContent.includes('<!DOCTYPE html>');
    const hasHtmlTag = htmlContent.includes('<html') && htmlContent.includes('</html>');
    const hasHeadTag = htmlContent.includes('<head>') && htmlContent.includes('</head>');
    const hasBodyTag = htmlContent.includes('<body>') && htmlContent.includes('</body>');
    
    // Check for unclosed script tags
    const scriptOpenCount = (htmlContent.match(/<script[^>]*>/g) || []).length;
    const scriptCloseCount = (htmlContent.match(/<\/script>/g) || []).length;
    
    // Check for basic JavaScript syntax issues
    const hasUnmatchedBraces = checkBraceMatching(htmlContent);
    
    console.log('HTML Validation Results:');
    console.log('- DOCTYPE:', hasDoctype ? '✅' : '❌');
    console.log('- HTML tags:', hasHtmlTag ? '✅' : '❌');
    console.log('- HEAD tags:', hasHeadTag ? '✅' : '❌');
    console.log('- BODY tags:', hasBodyTag ? '✅' : '❌');
    console.log('- Script tags balanced:', scriptOpenCount === scriptCloseCount ? '✅' : `❌ (${scriptOpenCount} open, ${scriptCloseCount} close)`);
    console.log('- Brace matching:', hasUnmatchedBraces ? '❌ Unmatched braces detected' : '✅');
    
    if (hasDoctype && hasHtmlTag && hasHeadTag && hasBodyTag && scriptOpenCount === scriptCloseCount && !hasUnmatchedBraces) {
        console.log('\n🎉 HTML file appears to be syntactically correct!');
    } else {
        console.log('\n⚠️ HTML file has potential issues that need to be fixed.');
    }
    
} catch (error) {
    console.error('Error reading file:', error.message);
}

function checkBraceMatching(content) {
    // Extract JavaScript content from script tags
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
    let match;
    let hasUnmatched = false;
    
    while ((match = scriptRegex.exec(content)) !== null) {
        const jsContent = match[1];
        if (checkJSBraces(jsContent)) {
            hasUnmatched = true;
            break;
        }
    }
    
    return hasUnmatched;
}

function checkJSBraces(jsContent) {
    const stack = [];
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const opening = Object.keys(pairs);
    const closing = Object.values(pairs);
    
    // Simple brace matching (ignores strings and comments for simplicity)
    for (let i = 0; i < jsContent.length; i++) {
        const char = jsContent[i];
        
        if (opening.includes(char)) {
            stack.push(char);
        } else if (closing.includes(char)) {
            const last = stack.pop();
            if (!last || pairs[last] !== char) {
                return true; // Unmatched
            }
        }
    }
    
    return stack.length > 0; // Unmatched if stack not empty
}