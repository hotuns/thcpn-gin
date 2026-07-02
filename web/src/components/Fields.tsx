import { Form, Input, Select } from "antd";
import type { ChangeEvent, ComponentProps, ReactNode } from "react";

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

interface TextInputProps extends Omit<ComponentProps<typeof Input>, "size"> {
  label: string;
  hint?: string;
}

export function TextInput({ label, hint, type, ...props }: TextInputProps) {
  const input =
    type === "password" ? (
      <Input.Password {...props} className="control" />
    ) : (
      <Input {...props} className="control" type={type} />
    );

  return (
    <Form.Item className="field" extra={hint} label={label} required={props.required}>
      {input}
    </Form.Item>
  );
}

interface SelectFieldProps {
  disabled?: boolean;
  label: string;
  hint?: string;
  name?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  options: Array<{ label: string; value: string }>;
  required?: boolean;
  value?: string;
}

export function SelectField({ disabled, label, hint, onChange, options, required, value }: SelectFieldProps) {
  return (
    <Form.Item className="field" extra={hint} label={label} required={required}>
      <Select
        className="control"
        disabled={disabled}
        onChange={(nextValue) => {
          onChange?.({ target: { value: nextValue } } as ChangeEvent<HTMLSelectElement>);
        }}
        options={options}
        value={(value as string | undefined) ?? ""}
      />
    </Form.Item>
  );
}

interface TextAreaProps extends Omit<ComponentProps<typeof Input.TextArea>, "size"> {
  label: string;
  hint?: string;
}

export function TextArea({ label, hint, ...props }: TextAreaProps) {
  return (
    <Form.Item className="field" extra={hint} label={label} required={props.required}>
      <Input.TextArea {...props} className="control textarea" />
    </Form.Item>
  );
}
