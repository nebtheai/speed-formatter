const express = require('express');
const cors = require('cors');
const prettier = require('prettier');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('static'));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'speed-formatter-mvp',
        version: '0.1.0',
        runtime: 'node.js',
        timestamp: new Date().toISOString()
    });
});

// Format code endpoint
app.post('/format', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { code, language, formatter } = req.body;
        
        if (!code) {
            return res.status(400).json({
                error: 'No code provided',
                details: 'Please provide code to format'
            });
        }
        
        console.log(`Formatting ${language} code with ${code.length} characters`);
        
        let formatted_code;
        let formatter_used;
        
        switch (language.toLowerCase()) {
            case 'javascript':
            case 'js':
                formatted_code = await formatWithPrettier(code, 'babel');
                formatter_used = 'prettier (babel)';
                break;
                
            case 'typescript':
            case 'ts':
                formatted_code = await formatWithPrettier(code, 'typescript');
                formatter_used = 'prettier (typescript)';
                break;
                
            case 'json':
                formatted_code = await formatWithPrettier(code, 'json');
                formatter_used = 'prettier (json)';
                break;
                
            case 'css':
                formatted_code = await formatWithPrettier(code, 'css');
                formatter_used = 'prettier (css)';
                break;
                
            case 'html':
                formatted_code = await formatWithPrettier(code, 'html');
                formatter_used = 'prettier (html)';
                break;
                
            case 'markdown':
            case 'md':
                formatted_code = await formatWithPrettier(code, 'markdown');
                formatter_used = 'prettier (markdown)';
                break;
                
            case 'rust':
                // For demo purposes, just clean up whitespace and basic formatting
                formatted_code = formatRustBasic(code);
                formatter_used = 'basic rust formatter';
                break;
                
            default:
                return res.status(400).json({
                    error: 'Unsupported language',
                    details: `Language '${language}' is not supported. Supported: javascript, typescript, json, css, html, markdown, rust`
                });
        }
        
        const execution_time_ms = Date.now() - startTime;
        
        console.log(`Successfully formatted in ${execution_time_ms}ms using ${formatter_used}`);
        
        res.json({
            formatted_code,
            execution_time_ms,
            formatter_used,
            status: 'success',
            input_length: code.length,
            output_length: formatted_code.length
        });
        
    } catch (error) {
        const execution_time_ms = Date.now() - startTime;
        console.error('Formatting failed:', error.message);
        
        res.status(500).json({
            error: 'Formatting failed',
            details: error.message,
            execution_time_ms
        });
    }
});

// Prettier formatting function
async function formatWithPrettier(code, parser) {
    try {
        return await prettier.format(code, {
            parser,
            semi: true,
            singleQuote: true,
            trailingComma: 'es5',
            tabWidth: 2,
            printWidth: 80
        });
    } catch (error) {
        throw new Error(`Prettier formatting failed: ${error.message}`);
    }
}

// Basic Rust formatter (for demo - just cleans whitespace and basic structure)
function formatRustBasic(code) {
    return code
        // Add spaces around operators
        .replace(/([=!<>+\-*\/])([^=])/g, '$1 $2')
        .replace(/([^=])([=!<>+\-*\/])/g, '$1 $2')
        // Add spaces after commas
        .replace(/,([^\s])/g, ', $1')
        // Add spaces around braces
        .replace(/\{([^\s])/g, '{ $1')
        .replace(/([^\s])\}/g, '$1 }')
        // Clean up multiple spaces
        .replace(/\s+/g, ' ')
        // Basic indentation (very simple)
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .replace(/\{/g, ' {\n    ')
        .replace(/\}/g, '\n}')
        // Clean up extra newlines
        .replace(/\n\s*\n/g, '\n')
        .trim();
}

// Performance benchmark endpoint
app.get('/benchmark', async (req, res) => {
    const sampleCode = `const messyCode={name:"test",value:123,items:[1,2,3,4,5],processItems:function(){return this.items.map(x=>x*2).filter(x=>x>4);}};`;
    
    const iterations = 100;
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await formatWithPrettier(sampleCode, 'babel');
        times.push(Date.now() - start);
    }
    
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    res.json({
        iterations,
        average_time_ms: Math.round(avgTime * 100) / 100,
        min_time_ms: minTime,
        max_time_ms: maxTime,
        sample_code_length: sampleCode.length,
        throughput_chars_per_ms: Math.round(sampleCode.length / avgTime)
    });
});

// Serve the main page
app.get('/', async (req, res) => {
    try {
        const html = await fs.readFile(path.join(__dirname, 'static', 'index.html'), 'utf8');
        res.send(html);
    } catch (error) {
        res.status(500).send('Error loading interface');
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Speed Formatter MVP running!');
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🎨 Format API: POST http://localhost:${PORT}/format`);
    console.log(`⚡ Benchmark: http://localhost:${PORT}/benchmark`);
    console.log(`🌐 Web Interface: http://localhost:${PORT}`);
    console.log('\n💡 Ready to format code at lightning speed!');
});