use rust_parser::{Token, TokenizerError, tokenize};

#[test]
fn test_tokenize_basic_object() {
    let input = r#"{"name": "OpenHeal", "version": 1.0}"#;
    let tokens = tokenize(input).expect("Should tokenize basic object");
    assert_eq!(
        tokens,
        vec![
            Token::OpenBrace,
            Token::StringLiteral("name".to_string()),
            Token::Colon,
            Token::StringLiteral("OpenHeal".to_string()),
            Token::Comma,
            Token::StringLiteral("version".to_string()),
            Token::Colon,
            Token::Number(1.0),
            Token::CloseBrace,
        ]
    );
}

#[test]
fn test_tokenize_escaped_quotes_in_string() {
    let input = r#"{"message": "Hello \"World\""}"#;
    let tokens = tokenize(input).expect("Should tokenize string with escaped quotes");
    assert_eq!(
        tokens,
        vec![
            Token::OpenBrace,
            Token::StringLiteral("message".to_string()),
            Token::Colon,
            Token::StringLiteral("Hello \"World\"".to_string()),
            Token::CloseBrace,
        ]
    );
}

#[test]
fn test_tokenize_unterminated_string_error() {
    let input = r#"{"name": "Unterminated"#;
    let result = tokenize(input);
    assert_eq!(result, Err(TokenizerError::UnterminatedString(9)));
}
