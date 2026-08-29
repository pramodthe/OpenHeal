#[derive(Debug, PartialEq, Clone)]
pub enum Token {
    Identifier(String),
    Number(f64),
    StringLiteral(String),
    Colon,
    Comma,
    OpenBrace,
    CloseBrace,
}

#[derive(Debug, PartialEq)]
pub enum TokenizerError {
    UnexpectedCharacter(char, usize),
    UnterminatedString(usize),
    InvalidNumber(usize),
}

pub fn tokenize(input: &str) -> Result<Vec<Token>, TokenizerError> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];
        if ch.is_whitespace() {
            i += 1;
            continue;
        }

        match ch {
            ':' => {
                tokens.push(Token::Colon);
                i += 1;
            }
            ',' => {
                tokens.push(Token::Comma);
                i += 1;
            }
            '{' => {
                tokens.push(Token::OpenBrace);
                i += 1;
            }
            '}' => {
                tokens.push(Token::CloseBrace);
                i += 1;
            }
            '"' => {
                let start = i;
                i += 1;
                let mut string_val = String::new();
                let mut terminated = false;

                while i < chars.len() {
                    // BUG: Does not check for escape backslash '\' before '"'
                    if chars[i] == '"' {
                        terminated = true;
                        i += 1;
                        break;
                    }
                    string_val.push(chars[i]);
                    i += 1;
                }

                if !terminated {
                    return Err(TokenizerError::UnterminatedString(start));
                }
                tokens.push(Token::StringLiteral(string_val));
            }
            _ if ch.is_alphabetic() || ch == '_' => {
                let mut ident = String::new();
                while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                    ident.push(chars[i]);
                    i += 1;
                }
                tokens.push(Token::Identifier(ident));
            }
            _ if ch.is_ascii_digit() => {
                let mut num_str = String::new();
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    num_str.push(chars[i]);
                    i += 1;
                }
                match num_str.parse::<f64>() {
                    Ok(val) => tokens.push(Token::Number(val)),
                    Err(_) => return Err(TokenizerError::InvalidNumber(i)),
                }
            }
            _ => return Err(TokenizerError::UnexpectedCharacter(ch, i)),
        }
    }

    Ok(tokens)
}
