package computedstream

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"math"
	"regexp"
	"sort"
	"strconv"
)

type Expression struct {
	source       string
	root         ast.Expr
	streamCodes  []string
	metadataKeys []string
}

func Compile(source string) (Expression, error) {
	if len(source) == 0 || len(source) > 1024 {
		return Expression{}, fmt.Errorf("formula length must be between 1 and 1024")
	}
	parseSource := regexp.MustCompile(`\bif\s*\(`).ReplaceAllString(source, "iff(")
	root, err := parser.ParseExpr(parseSource)
	if err != nil {
		return Expression{}, fmt.Errorf("invalid formula: %w", err)
	}
	streams := map[string]struct{}{}
	metadata := map[string]struct{}{}
	if err := validateExpression(root, streams, metadata); err != nil {
		return Expression{}, err
	}
	return Expression{
		source:       source,
		root:         root,
		streamCodes:  sortedKeys(streams),
		metadataKeys: sortedKeys(metadata),
	}, nil
}

func (e Expression) StreamCodes() []string {
	return append([]string(nil), e.streamCodes...)
}

func (e Expression) MetadataKeys() []string {
	return append([]string(nil), e.metadataKeys...)
}

func (e Expression) Evaluate(streams, metadata map[string]float64) (float64, error) {
	value, err := evaluateNode(e.root, streams, metadata)
	if err != nil {
		return 0, err
	}
	if !isFinite(value) {
		return 0, fmt.Errorf("formula returned a non-finite value")
	}
	return value, nil
}

func validateExpression(node ast.Expr, streams, metadata map[string]struct{}) error {
	switch item := node.(type) {
	case *ast.BasicLit:
		if item.Kind != token.INT && item.Kind != token.FLOAT {
			return fmt.Errorf("only numeric literals are allowed")
		}
		_, err := strconv.ParseFloat(item.Value, 64)
		return err
	case *ast.ParenExpr:
		return validateExpression(item.X, streams, metadata)
	case *ast.UnaryExpr:
		if item.Op != token.ADD && item.Op != token.SUB && item.Op != token.NOT {
			return fmt.Errorf("unsupported unary operator %s", item.Op)
		}
		return validateExpression(item.X, streams, metadata)
	case *ast.BinaryExpr:
		switch item.Op {
		case token.ADD, token.SUB, token.MUL, token.QUO,
			token.EQL, token.NEQ, token.LSS, token.LEQ, token.GTR, token.GEQ,
			token.LAND, token.LOR:
		default:
			return fmt.Errorf("unsupported operator %s", item.Op)
		}
		if err := validateExpression(item.X, streams, metadata); err != nil {
			return err
		}
		return validateExpression(item.Y, streams, metadata)
	case *ast.SelectorExpr:
		scope, ok := item.X.(*ast.Ident)
		if !ok || (scope.Name != "stream" && scope.Name != "meta") {
			return fmt.Errorf("variables must use stream.* or meta.*")
		}
		if scope.Name == "stream" {
			streams[item.Sel.Name] = struct{}{}
		} else {
			metadata[item.Sel.Name] = struct{}{}
		}
		return nil
	case *ast.CallExpr:
		name, ok := item.Fun.(*ast.Ident)
		if !ok || !allowedFunction(name.Name, len(item.Args)) {
			return fmt.Errorf("unsupported function")
		}
		for _, argument := range item.Args {
			if err := validateExpression(argument, streams, metadata); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("unsupported formula expression %T", node)
	}
}

func evaluateNode(node ast.Expr, streams, metadata map[string]float64) (float64, error) {
	switch item := node.(type) {
	case *ast.BasicLit:
		return strconv.ParseFloat(item.Value, 64)
	case *ast.ParenExpr:
		return evaluateNode(item.X, streams, metadata)
	case *ast.SelectorExpr:
		scope := item.X.(*ast.Ident).Name
		values := streams
		if scope == "meta" {
			values = metadata
		}
		value, ok := values[item.Sel.Name]
		if !ok {
			return 0, fmt.Errorf("missing %s.%s", scope, item.Sel.Name)
		}
		return value, nil
	case *ast.UnaryExpr:
		value, err := evaluateNode(item.X, streams, metadata)
		if err != nil {
			return 0, err
		}
		switch item.Op {
		case token.ADD:
			return value, nil
		case token.SUB:
			return -value, nil
		case token.NOT:
			return boolNumber(!numberBool(value)), nil
		}
	case *ast.BinaryExpr:
		left, err := evaluateNode(item.X, streams, metadata)
		if err != nil {
			return 0, err
		}
		if item.Op == token.LAND && !numberBool(left) {
			return 0, nil
		}
		if item.Op == token.LOR && numberBool(left) {
			return 1, nil
		}
		right, err := evaluateNode(item.Y, streams, metadata)
		if err != nil {
			return 0, err
		}
		switch item.Op {
		case token.ADD:
			return left + right, nil
		case token.SUB:
			return left - right, nil
		case token.MUL:
			return left * right, nil
		case token.QUO:
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			return left / right, nil
		case token.EQL:
			return boolNumber(left == right), nil
		case token.NEQ:
			return boolNumber(left != right), nil
		case token.LSS:
			return boolNumber(left < right), nil
		case token.LEQ:
			return boolNumber(left <= right), nil
		case token.GTR:
			return boolNumber(left > right), nil
		case token.GEQ:
			return boolNumber(left >= right), nil
		case token.LAND:
			return boolNumber(numberBool(left) && numberBool(right)), nil
		case token.LOR:
			return boolNumber(numberBool(left) || numberBool(right)), nil
		}
	case *ast.CallExpr:
		name := item.Fun.(*ast.Ident).Name
		if name == "iff" {
			condition, err := evaluateNode(item.Args[0], streams, metadata)
			if err != nil {
				return 0, err
			}
			if numberBool(condition) {
				return evaluateNode(item.Args[1], streams, metadata)
			}
			return evaluateNode(item.Args[2], streams, metadata)
		}
		values := make([]float64, 0, len(item.Args))
		for _, argument := range item.Args {
			value, err := evaluateNode(argument, streams, metadata)
			if err != nil {
				return 0, err
			}
			values = append(values, value)
		}
		switch name {
		case "min":
			return math.Min(values[0], values[1]), nil
		case "max":
			return math.Max(values[0], values[1]), nil
		case "abs":
			return math.Abs(values[0]), nil
		case "round":
			return math.Round(values[0]), nil
		case "sqrt":
			if values[0] < 0 {
				return 0, fmt.Errorf("sqrt requires a non-negative value")
			}
			return math.Sqrt(values[0]), nil
		case "pow":
			return math.Pow(values[0], values[1]), nil
		}
	}
	return 0, fmt.Errorf("unsupported formula node")
}

func allowedFunction(name string, arguments int) bool {
	expected := map[string]int{
		"min": 2, "max": 2, "abs": 1, "round": 1, "sqrt": 1, "pow": 2, "iff": 3,
	}
	return expected[name] == arguments
}

func sortedKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func numberBool(value float64) bool { return value != 0 }
func boolNumber(value bool) float64 {
	if value {
		return 1
	}
	return 0
}
func isFinite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
